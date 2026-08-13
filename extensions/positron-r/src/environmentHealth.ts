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
import { LOGGER } from './extension';
import { getArkKernelPath, normalizeWindowsArch, sniffMachOBinaryArchitecture, sniffWindowsBinaryArchitecture } from './kernel';
import { discoverRInstallations } from './provider';
import { friendlyReason, ReasonRejected, RInstallation } from './r-installation';

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
 * The claim a check makes, phrased so it reads the same whatever the outcome is:
 * the UI uses it as the row title and shows `status` separately. Callers that
 * never ran the probe (a skipped item, a probe that threw) still need the text,
 * so it lives here rather than inside each probe.
 */
export function itemSummary(id: HealthItemId): string {
	// Record<HealthItemId, string> requires an entry per id, so adding a check
	// without a summary is a compile error. Built per call because
	// vscode.l10n.t needs the activated l10n bundle.
	const summaries: Record<HealthItemId, string> = {
		discovery: vscode.l10n.t('Positron can discover R installations'),
		rInstalled: vscode.l10n.t('A supported R is installed'),
		environmentReady: vscode.l10n.t('The R installation is ready to use with Positron'),
	};
	return summaries[id];
}

function diagnosticsFix(): HealthItemFix {
	return {
		commandId: 'positron.startupDiagnostics.show',
		label: vscode.l10n.t('Show Runtime Startup Diagnostics'),
	};
}

export function probeDiscovery(deps: { binaryCount: number; error?: string }): HealthItem {
	const id = 'discovery';
	const summary = itemSummary(id);
	if (deps.error) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t('R discovery could not complete: {0}', deps.error),
			fix: diagnosticsFix(),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	if (deps.binaryCount === 0) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t('No R installations were found on this machine.'),
			fix: diagnosticsFix(),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	return { id, status: 'pass', summary };
}

export function probeRInstalled(deps: { installations: RInstallationLike[] }): HealthItem {
	const id = 'rInstalled';
	const summary = itemSummary(id);
	// `usable` implies `supported`: RInstallation only sets it inside the
	// supported branch (r-installation.ts:323).
	if (deps.installations.some((i) => i.usable)) {
		return { id, status: 'pass', summary };
	}

	// Version first: an old R is always ALSO marked unusable, so the generic
	// branch would otherwise shadow the more actionable "your R is 4.0.5".
	// Keyed on the reason rather than `supported`, which also reads false for a
	// broken install that never got far enough to have a version at all.
	const unsupported = deps.installations.find(
		(i) => i.reasonRejected === ReasonRejected.unsupported);
	if (unsupported) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t(
				'The R installation at {0} is version {1}, below the minimum supported version.',
				unsupported.binpath, unsupported.version),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	const rejected = deps.installations.find((i) => !i.usable);
	if (rejected) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t(
				'The R installation at {0} is unusable: {1}.',
				rejected.binpath, friendlyReason(rejected.reasonRejected)),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	// Unreachable via getEnvironmentHealth: the same array feeds probeDiscovery,
	// so an empty list fails there first. Kept for direct callers.
	return {
		id, status: 'fail', summary,
		detail: vscode.l10n.t('There is no R installation to evaluate.'),
		learnMoreUrl: R_INSTALL_DOCS,
	};
}

/**
 * The environmentReady verdict when no usable R installation could be picked at
 * all: neither the registered preferred runtime nor the freshly discovered list
 * yielded one.
 */
export function probeNoUsableTarget(): HealthItem {
	return {
		id: 'environmentReady',
		status: 'fail',
		summary: itemSummary('environmentReady'),
		detail: vscode.l10n.t('Positron could not resolve an R installation to use.'),
		fix: diagnosticsFix(),
		learnMoreUrl: R_INSTALL_DOCS,
	};
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
	usable.sort((a, b) => {
		if (a.current || b.current) {
			return Number(b.current) - Number(a.current);
		}
		// Version descending, ties broken by architecture, as in provider.ts.
		return semver.compare(b.semVersion, a.semVersion) || a.arch.localeCompare(b.arch);
	});
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
	const summary = itemSummary(id);

	if (!deps.usable) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t(
				'This R installation is unusable: {0}.', friendlyReason(deps.rejectedReason)),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	if (!deps.versionSupported) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t(
				'This R installation is version {0}, below the minimum supported version.',
				deps.version),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	// Ark precedes libR because resolving the libR path needs ark's architecture.
	if (!deps.arkFound) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t('The R kernel (ark) could not be located in this installation of Positron.'),
			fix: diagnosticsFix(),
		};
	}
	// Arch precedes libR: resolveLibRPath picks the Windows layout from ark's
	// architecture, so a mismatched ark resolves a path R never uses. Reporting
	// --enable-R-shlib there would name the wrong cause.
	if (deps.archMismatch) {
		return {
			id, status: 'warn', summary,
			detail: vscode.l10n.t(
				'This R is built for {0} but the R kernel is built for {1}. Sessions may fail to start or run slowly.',
				deps.rArch ?? 'unknown', deps.arkArch ?? 'unknown'),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	if (!deps.libRExists) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t(
				"R's shared library was not found at {0}. If this is a custom build of R, ensure it is compiled with --enable-R-shlib.",
				deps.libRPath),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	return { id, status: 'pass', summary };
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
	return { id, status: 'skipped', summary: itemSummary(id) };
}

async function runItem(
	id: HealthItemId,
	produce: () => HealthItem | Promise<HealthItem>
): Promise<HealthItem> {
	try {
		return await produce();
	} catch (ex) {
		return {
			id, status: 'fail', summary: itemSummary(id),
			detail: vscode.l10n.t(
				'Health check failed: {0}', ex instanceof Error ? ex.message : String(ex)),
		};
	}
}

function finalize(items: HealthItem[]): REnvironmentHealthResult {
	return { ok: !items.some((i) => i.status === 'fail'), items };
}

export async function assembleItems(producers: {
	discovery: () => HealthItem | Promise<HealthItem>;
	rInstalled: () => HealthItem | Promise<HealthItem>;
	ready: () => HealthItem | Promise<HealthItem>;
}): Promise<REnvironmentHealthResult> {
	const items: HealthItem[] = [];

	const discovery = await runItem('discovery', producers.discovery);
	items.push(discovery);
	if (discovery.status === 'fail') {
		items.push(skipped('rInstalled'), skipped('environmentReady'));
		return finalize(items);
	}

	const rInstalled = await runItem('rInstalled', producers.rInstalled);
	items.push(rInstalled);
	if (rInstalled.status === 'fail') {
		items.push(skipped('environmentReady'));
		return finalize(items);
	}

	items.push(await runItem('environmentReady', producers.ready));
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

export async function getEnvironmentHealth(): Promise<REnvironmentHealthResult> {
	// Discovery runs once per invocation and every probe below reads that one
	// snapshot. Nothing is cached across calls; each call re-runs full discovery.
	let all: RInstallation[] = [];
	let discoveryError: string | undefined;
	try {
		all = await discoverRInstallations();
	} catch (ex) {
		discoveryError = ex instanceof Error ? ex.message : String(ex);
	}

	const preferred = await positron.runtime.getPreferredRuntime('r');
	const target = selectTargetInstallation(all, preferred?.runtimePath);

	const result = await assembleItems({
		discovery: () => probeDiscovery({ binaryCount: all.length, error: discoveryError }),
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
	});

	result.rBinPath = target?.binpath;
	result.rHome = target?.homepath;
	return result;
}

export function logEnvironmentHealth(result: REnvironmentHealthResult): void {
	LOGGER.info('===================== [START] R ENVIRONMENT HEALTH =====================');
	LOGGER.info(JSON.stringify(result, null, 2));
	LOGGER.info('====================== [END] R ENVIRONMENT HEALTH ======================');
}
