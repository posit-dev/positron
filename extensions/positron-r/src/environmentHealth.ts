/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as positron from 'positron';
import * as semver from 'semver';
import * as vscode from 'vscode';
import { getArkKernelPath, normalizeWindowsArch, sniffMachOBinaryArchitecture, sniffWindowsBinaryArchitecture } from './kernel';
import { discoverRInstallations } from './provider';
import { MINIMUM_R_VERSION } from './constants';
import { ReasonRejected, RInstallation } from './r-installation';
import { compareRInstallations } from './startup-choice';

/** Architecture vocabulary used by the ark binary sniffers. */
export type ArkArch = 'arm64' | 'x64';

/**
 * Resolves the libR path exactly as ark does, so this check agrees with the
 * process that actually loads the library. See
 * `harp::find_r_shared_library_folder`.
 *
 * Platform and architecture are parameters rather than reads of `os.platform()`
 * so every row is testable on any machine.
 */
export function resolveLibRPath(
	rHome: string,
	platform: NodeJS.Platform,
	arkArch: ArkArch | undefined
): string {
	if (platform === 'win32') {
		// arm64 ark uses a flatter layout; everything else lives under bin/x64.
		const folder = arkArch === 'arm64'
			? path.join(rHome, 'bin')
			: path.join(rHome, 'bin', 'x64');
		return path.join(folder, 'R.dll');
	}
	const name = platform === 'darwin' ? 'libR.dylib' : 'libR.so';
	return path.join(rHome, 'lib', name);
}

/**
 * True when R and ark are built for different architectures. An unknown value
 * on either side yields false: missing information is not evidence of trouble.
 */
export function archesMismatch(rArch: string | undefined, arkArch: ArkArch | undefined): boolean {
	if (!rArch || !arkArch) {
		return false;
	}
	const normalizedR = normalizeWindowsArch(rArch);
	if (!normalizedR) {
		return false;
	}
	return normalizedR !== arkArch;
}

export type HealthItemStatus = 'pass' | 'warn' | 'fail' | 'skipped';

/** The three checks, in dependency order. */
export type HealthItemId = 'discovery' | 'rInstalled' | 'environmentReady';

export interface HealthItemFix {
	/** Extension OR core command id. */
	commandId: string;
	/** Fully computed at check time; plain JSON only (no vscode types). */
	args?: unknown[];
	/** Localized button label. */
	label: string;
}

export interface HealthItem {
	id: HealthItemId;
	status: HealthItemStatus;
	/** Localized one-liner. */
	summary: string;
	/** Localized, with actual paths and versions. */
	detail?: string;
	fix?: HealthItemFix;
	learnMoreUrl?: string;
}

/** Structural subset of RInstallation, so probes are testable without real installs. */
export interface RInstallationLike {
	binpath: string;
	usable: boolean;
	version: string;
	reasonRejected: ReasonRejected | null;
}

const R_INSTALL_DOCS = 'https://positron.posit.co/r-installations';

/**
 * Where the developer-facing text behind a failed check goes. The report shows a
 * generic sentence, so this is the only place the real message survives.
 *
 * Keep in sync with positron-python's `environmentHealth.ts`.
 */
export type LogError = (message: string, error?: unknown) => void;

/**
 * Sends the text to an output channel at warn level, with the stack when there is
 * one.
 *
 * `warn()` renders an Error to its message alone: it calls `format()` without the
 * verbose flag, which drops the stack (see `log.ts`). The stack is the part that
 * says which line threw, so pass it as the argument instead of the Error.
 */
export function logErrorTo(channel: Pick<vscode.LogOutputChannel, 'warn'>): LogError {
	return (message, error) => {
		if (error === undefined) {
			channel.warn(message);
			return;
		}
		channel.warn(message, error instanceof Error ? error.stack ?? error.message : error);
	};
}

/** Row titles for one check, one per status. `warn` is only set for checks that can warn. */
interface ItemSummaries {
	pass: string;
	fail: string;
	warn?: string;
	skipped: string;
}

/**
 * The row title for a check, matching its status: what passed, what is
 * wrong, or (for a skipped item) just the check's name. The detail line under
 * a warn or fail row says why and what to do. Callers that never ran the probe
 * (a skipped item, a probe that threw) still need the text, so it lives here
 * rather than inside each probe.
 */
export function itemSummary(id: HealthItemId, status: HealthItemStatus): string {
	// Record<HealthItemId, ...> requires an entry per id, so adding a check
	// without summaries is a compile error. Built per call because
	// vscode.l10n.t needs the activated l10n bundle.
	const summaries: Record<HealthItemId, ItemSummaries> = {
		discovery: {
			pass: vscode.l10n.t('R is available on this machine'),
			fail: vscode.l10n.t('Positron cannot find R on this machine'),
			skipped: vscode.l10n.t('R installation discovery'),
		},
		rInstalled: {
			pass: vscode.l10n.t('A supported R is available'),
			fail: vscode.l10n.t('A supported R is not available'),
			skipped: vscode.l10n.t('Supported R version'),
		},
		environmentReady: {
			pass: vscode.l10n.t('The R installation is ready to use with Positron'),
			fail: vscode.l10n.t('The R installation is not ready to use with Positron'),
			warn: vscode.l10n.t('The R installation may not work reliably with Positron'),
			skipped: vscode.l10n.t('R installation compatibility'),
		},
	};
	// A check with no warn text falls back to its name, which reads correctly
	// next to any icon.
	return summaries[id][status] ?? summaries[id].skipped;
}

/**
 * Builds a health item whose title comes from its status, so the two can
 * never disagree. Every item in this file is built through here.
 */
function healthItem(
	id: HealthItemId,
	status: HealthItemStatus,
	rest?: Omit<HealthItem, 'id' | 'status' | 'summary'>
): HealthItem {
	return { id, status, summary: itemSummary(id, status), ...rest };
}

/**
 * Why an R installation was rejected, as a localized sentence for the report.
 * friendlyReason() in r-installation.ts is the log wording and is not
 * localized. A reason without a sentence here falls back to a generic one.
 */
function rejectionSentence(reason: ReasonRejected | null): string {
	switch (reason) {
		case ReasonRejected.invalid:
			return vscode.l10n.t('The installation is incomplete or damaged.');
		case ReasonRejected.unsupported:
			return vscode.l10n.t('Positron needs R {0} or later.', MINIMUM_R_VERSION);
		case ReasonRejected.nonOrthogonal:
			return vscode.l10n.t('This R shares a framework folder with other versions and is not the current one.');
		case ReasonRejected.excluded:
			return vscode.l10n.t('Your settings exclude this location.');
		default:
			return vscode.l10n.t('Positron cannot tell why.');
	}
}

function diagnosticsFix(): HealthItemFix {
	return {
		commandId: 'positron.startupDiagnostics.show',
		label: vscode.l10n.t('Show Runtime Startup Diagnostics'),
	};
}

export function probeDiscovery(deps: { binaryCount: number; discoveryFailed?: boolean }): HealthItem {
	const id = 'discovery';
	if (deps.discoveryFailed) {
		return healthItem(id, 'fail', {
			detail: vscode.l10n.t('R discovery could not complete.'),
			fix: diagnosticsFix(),
			learnMoreUrl: R_INSTALL_DOCS,
		});
	}
	if (deps.binaryCount === 0) {
		return healthItem(id, 'fail', {
			detail: vscode.l10n.t('Install R.'),
			fix: diagnosticsFix(),
			learnMoreUrl: R_INSTALL_DOCS,
		});
	}
	return healthItem(id, 'pass');
}

export function probeRInstalled(deps: { installations: RInstallationLike[] }): HealthItem {
	const id = 'rInstalled';
	// `usable` implies `supported`: RInstallation only sets it inside the
	// supported branch (r-installation.ts:323).
	if (deps.installations.some((i) => i.usable)) {
		return healthItem(id, 'pass');
	}

	// Version first: an old R is always ALSO marked unusable, so the generic
	// branch would otherwise shadow the more actionable "your R is 4.0.5".
	// Keyed on the reason rather than `supported`, which also reads false for a
	// broken install that never got far enough to have a version at all.
	const unsupported = deps.installations.find(
		(i) => i.reasonRejected === ReasonRejected.unsupported);
	if (unsupported) {
		return healthItem(id, 'fail', {
			detail: vscode.l10n.t(
				'The R at {0} is version {1}. Positron needs R {2} or later.',
				unsupported.binpath, unsupported.version, MINIMUM_R_VERSION),
			learnMoreUrl: R_INSTALL_DOCS,
		});
	}
	const rejected = deps.installations.find((i) => !i.usable);
	if (rejected) {
		return healthItem(id, 'fail', {
			detail: vscode.l10n.t(
				'Positron cannot use the R at {0}. {1}',
				rejected.binpath, rejectionSentence(rejected.reasonRejected)),
			learnMoreUrl: R_INSTALL_DOCS,
		});
	}
	// Unreachable via getEnvironmentHealth: the same array feeds probeDiscovery,
	// so an empty list fails there first. Kept for direct callers.
	return healthItem(id, 'fail', {
		detail: vscode.l10n.t('No R installation is available to check.'),
		learnMoreUrl: R_INSTALL_DOCS,
	});
}

/**
 * The environmentReady verdict when no usable R installation could be picked at
 * all: neither the registered preferred runtime nor the freshly discovered list
 * yielded one.
 */
export function probeNoUsableTarget(): HealthItem {
	return healthItem('environmentReady', 'fail', {
		detail: vscode.l10n.t('Positron cannot choose an R installation to use.'),
		fix: diagnosticsFix(),
		learnMoreUrl: R_INSTALL_DOCS,
	});
}

/** Structural subset of RInstallation needed to rank fallback candidates. */
export interface RInstallationRankable {
	binpath: string;
	usable: boolean;
	current: boolean;
	semVersion: semver.SemVer;
	arch: string;
}

/**
 * Picks the installation the report should describe.
 *
 * The preferred runtime comes from the registry while `all` is a fresh
 * discovery, so they can disagree (nothing registered yet, or a settings change
 * between them). Fall back to whatever `rRuntimeDiscoverer` would rank first
 * rather than reporting a failure on a healthy machine.
 */
export function selectTargetInstallation<T extends RInstallationRankable>(
	all: T[],
	preferredRuntimePath: string | undefined
): T | undefined {
	if (preferredRuntimePath) {
		// runtimePath is set directly from RInstallation.binpath in makeMetadata,
		// so this join is exact rather than heuristic.
		const match = all.find((i) => i.binpath === preferredRuntimePath);
		if (match) {
			return match;
		}
	}
	const usable = all.filter((i) => i.usable);
	usable.sort(compareRInstallations);
	return usable[0];
}

export function probeEnvironmentReady(deps: {
	usable: boolean;
	rejectedReason: ReasonRejected | null;
	versionSupported: boolean;
	version: string;
	arkFound: boolean;
	libRPath: string;
	libRExists: boolean;
	archMismatch: boolean;
	rArch?: string;
	arkArch?: ArkArch;
}): HealthItem {
	const id = 'environmentReady';

	if (!deps.usable) {
		return healthItem(id, 'fail', {
			detail: vscode.l10n.t(
				'Positron cannot use this R installation. {0}', rejectionSentence(deps.rejectedReason)),
			learnMoreUrl: R_INSTALL_DOCS,
		});
	}
	if (!deps.versionSupported) {
		return healthItem(id, 'fail', {
			detail: vscode.l10n.t(
				'This R installation is version {0}. Positron needs R {1} or later.',
				deps.version, MINIMUM_R_VERSION),
			learnMoreUrl: R_INSTALL_DOCS,
		});
	}
	// Ark precedes libR because resolving the libR path needs ark's architecture.
	if (!deps.arkFound) {
		return healthItem(id, 'fail', {
			detail: vscode.l10n.t('Positron cannot find its R kernel (ark), so R sessions cannot start.'),
			fix: diagnosticsFix(),
		});
	}
	// Arch precedes libR: resolveLibRPath picks the Windows layout from ark's
	// architecture, so a mismatched ark resolves a path R never uses. Reporting
	// --enable-R-shlib there would name the wrong cause.
	if (deps.archMismatch) {
		return healthItem(id, 'warn', {
			detail: vscode.l10n.t(
				'This R is built for {0}, but the Positron R kernel is built for {1}. R sessions may not start or may run slowly. Install an R built for {1}.',
				deps.rArch ?? 'unknown', deps.arkArch ?? 'unknown'),
			learnMoreUrl: R_INSTALL_DOCS,
		});
	}
	if (!deps.libRExists) {
		return healthItem(id, 'fail', {
			detail: vscode.l10n.t(
				'Positron cannot find the R shared library at {0}. If you built R yourself, rebuild R with the --enable-R-shlib option.',
				deps.libRPath),
			learnMoreUrl: R_INSTALL_DOCS,
		});
	}
	return healthItem(id, 'pass');
}

export interface REnvironmentHealthResult {
	/** True when no item has status 'fail'. Warn and skipped do not affect it. */
	ok: boolean;
	/** Always all three, in dependency order. */
	items: HealthItem[];
	rBinPath?: string;
	rHome?: string;
}

function skipped(id: HealthItemId): HealthItem {
	return healthItem(id, 'skipped');
}

async function runItem(
	id: HealthItemId,
	produce: () => HealthItem | Promise<HealthItem>,
	logError: LogError
): Promise<HealthItem> {
	try {
		return await produce();
	} catch (ex) {
		// No curated action to offer for an unexpected probe failure, so this item carries no fix.
		logError(`Environment health check '${id}' failed`, ex);
		return healthItem(id, 'fail', { detail: vscode.l10n.t('This check could not be completed.') });
	}
}

function finalize(items: HealthItem[]): REnvironmentHealthResult {
	return { ok: !items.some((i) => i.status === 'fail'), items };
}

export async function assembleItems(
	producers: {
		discovery: () => HealthItem | Promise<HealthItem>;
		rInstalled: () => HealthItem | Promise<HealthItem>;
		ready: () => HealthItem | Promise<HealthItem>;
	},
	logError: LogError = () => { }
): Promise<REnvironmentHealthResult> {
	const items: HealthItem[] = [];

	const discovery = await runItem('discovery', producers.discovery, logError);
	items.push(discovery);
	if (discovery.status === 'fail') {
		items.push(skipped('rInstalled'), skipped('environmentReady'));
		return finalize(items);
	}

	const rInstalled = await runItem('rInstalled', producers.rInstalled, logError);
	items.push(rInstalled);
	if (rInstalled.status === 'fail') {
		items.push(skipped('environmentReady'));
		return finalize(items);
	}

	items.push(await runItem('environmentReady', producers.ready, logError));
	return finalize(items);
}

/** Sniffs the architecture of the resolved ark binary, not of R. */
function arkArchitecture(arkPath: string | undefined): ArkArch | undefined {
	if (!arkPath) {
		return undefined;
	}
	if (os.platform() === 'win32') {
		return sniffWindowsBinaryArchitecture(arkPath);
	}
	if (os.platform() === 'darwin') {
		const sniffed = sniffMachOBinaryArchitecture(arkPath);
		return sniffed === 'x86_64' ? 'x64' : sniffed;
	}
	// Linux: cross-architecture R is not a practical concern, so skip the check.
	return undefined;
}

/**
 * Turns a thrown discovery error into the flag probeDiscovery takes. The exception is developer
 * text, so it goes to the log; probeDiscovery never receives it. A failure yields an empty list,
 * which is what the probes below read.
 *
 * Generic over the installation type so a test can supply plain stand-ins.
 */
export async function discoverInstallations<T>(
	discover: () => Promise<T[]>,
	logError: LogError
): Promise<{ installations: T[]; discoveryFailed: boolean }> {
	try {
		return { installations: await discover(), discoveryFailed: false };
	} catch (ex) {
		logError('R installation discovery failed', ex);
		return { installations: [], discoveryFailed: true };
	}
}

export async function getEnvironmentHealth(
	logError: LogError
): Promise<REnvironmentHealthResult> {
	// Discovery runs once per invocation and every probe below reads that one
	// snapshot. Nothing is cached across calls; each call re-runs full discovery.
	const { installations: all, discoveryFailed } = await discoverInstallations<RInstallation>(
		discoverRInstallations, logError);

	const preferred = await positron.runtime.getPreferredRuntime('r');
	const target = selectTargetInstallation(all, preferred?.runtimePath);

	const result = await assembleItems({
		discovery: () => probeDiscovery({ binaryCount: all.length, discoveryFailed }),
		rInstalled: () => probeRInstalled({ installations: all }),
		ready: () => {
			if (!target) {
				return probeNoUsableTarget();
			}
			const arkPath = getArkKernelPath({
				rBinaryPath: target.binpath,
				rHomePath: target.homepath,
				rArch: target.arch,
			});
			const arkArch = arkArchitecture(arkPath);
			const libRPath = resolveLibRPath(target.homepath, os.platform(), arkArch);
			return probeEnvironmentReady({
				usable: target.usable,
				rejectedReason: target.reasonRejected,
				versionSupported: target.supported,
				version: target.version,
				// getArkKernelPath returns the positron.r.kernel.path setting
				// verbatim, so a stale override must be checked on disk.
				arkFound: arkPath !== undefined && fs.existsSync(arkPath),
				libRPath,
				libRExists: fs.existsSync(libRPath),
				archMismatch: archesMismatch(target.arch, arkArch),
				rArch: target.arch,
				arkArch,
			});
		},
	}, logError);

	result.rBinPath = target?.binpath;
	result.rHome = target?.homepath;
	return result;
}
