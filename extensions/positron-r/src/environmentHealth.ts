/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { normalizeWindowsArch } from './kernel';

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

/** The four checks, in dependency order. */
export type HealthItemId = 'discovery' | 'rInstalled' | 'environmentReady' | 'dedicatedEnvironment';

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
	supported: boolean;
	version: string;
	reasonRejected: string | null;
}

const R_INSTALL_DOCS = 'https://positron.posit.co/r-installations';

function diagnosticsFix(): HealthItemFix {
	return {
		commandId: 'positron.startupDiagnostics.show',
		label: vscode.l10n.t('Show Runtime Startup Diagnostics'),
	};
}

export function probeDiscovery(deps: { binaryCount: number; error?: string }): HealthItem {
	const id = 'discovery';
	const summary = vscode.l10n.t('Positron can discover R installations');
	if (deps.error) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t('R discovery could not complete: {0}', deps.error),
			fix: diagnosticsFix(),
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
	const summary = vscode.l10n.t('A supported R is installed');
	if (deps.installations.some((i) => i.usable && i.supported)) {
		return { id, status: 'pass', summary };
	}

	// Explain why the closest candidate did not qualify rather than just
	// reporting absence: the user usually does have R, just not one we can use.
	// Version is checked before the generic rejection branch because an old R is
	// always ALSO marked unusable (r-installation.ts:320-340), and "your R is
	// 4.0.5" is more actionable than "unusable: unsupported".
	const unsupported = deps.installations.find((i) => !i.supported);
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
				rejected.binpath, rejected.reasonRejected ?? 'unknown'),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	return {
		id, status: 'fail', summary,
		detail: vscode.l10n.t('No R installations were found on this machine.'),
		learnMoreUrl: R_INSTALL_DOCS,
	};
}

export function probeEnvironmentReady(deps: {
	usable: boolean;
	rejectedReason?: string;
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
	const summary = vscode.l10n.t('The R installation is ready to use with Positron');

	if (!deps.usable) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t(
				'This R installation is unusable: {0}.', deps.rejectedReason ?? 'unknown'),
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
	if (!deps.libRExists) {
		return {
			id, status: 'fail', summary,
			detail: vscode.l10n.t(
				"R's shared library was not found at {0}. If this is a custom build of R, ensure it is compiled with --enable-R-shlib.",
				deps.libRPath),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	if (deps.archMismatch) {
		return {
			id, status: 'warn', summary,
			detail: vscode.l10n.t(
				'This R is built for {0} but the R kernel is built for {1}. Sessions may fail to start or run slowly.',
				deps.rArch ?? 'unknown', deps.arkArch ?? 'unknown'),
			learnMoreUrl: R_INSTALL_DOCS,
		};
	}
	return { id, status: 'pass', summary };
}

export function probeDedicatedEnvironment(deps: {
	workspaceFolderPath?: string;
	hasRenv: boolean;
}): HealthItem {
	const id = 'dedicatedEnvironment';
	const summary = vscode.l10n.t('The workspace uses a dedicated R environment');

	if (!deps.workspaceFolderPath) {
		return {
			id, status: 'warn', summary,
			detail: vscode.l10n.t('No folder is open. Open or create a folder to use a project-local renv library.'),
			fix: {
				commandId: 'positron.workbench.action.newFolderFromTemplate',
				label: vscode.l10n.t('New Folder from Template'),
			},
		};
	}
	if (deps.hasRenv) {
		return { id, status: 'pass', summary };
	}
	return {
		id, status: 'fail', summary,
		detail: vscode.l10n.t(
			'{0} does not use renv. Initialize renv to isolate this project\'s packages.',
			deps.workspaceFolderPath),
		fix: { commandId: 'r.renvInit', label: vscode.l10n.t('Initialize renv') },
	};
}

export interface REnvironmentHealthResult {
	/** True when no item has status 'fail'. Warn and skipped do not affect it. */
	ok: boolean;
	/** Always all four, in dependency order. */
	items: HealthItem[];
	rBinPath?: string;
	rHome?: string;
}

function skipped(id: HealthItemId): HealthItem {
	return { id, status: 'skipped', summary: id };
}

async function runItem(
	id: HealthItemId,
	produce: () => HealthItem | Promise<HealthItem>
): Promise<HealthItem> {
	try {
		return await produce();
	} catch (ex) {
		return {
			id, status: 'fail', summary: id,
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
	dedicated: () => HealthItem | Promise<HealthItem>;
}): Promise<REnvironmentHealthResult> {
	const items: HealthItem[] = [];

	const discovery = await runItem('discovery', producers.discovery);
	items.push(discovery);
	if (discovery.status === 'fail') {
		items.push(skipped('rInstalled'), skipped('environmentReady'), skipped('dedicatedEnvironment'));
		return finalize(items);
	}

	const rInstalled = await runItem('rInstalled', producers.rInstalled);
	items.push(rInstalled);
	if (rInstalled.status === 'fail') {
		items.push(skipped('environmentReady'), skipped('dedicatedEnvironment'));
		return finalize(items);
	}

	// dedicatedEnvironment follows environmentReady: an unusable R makes the
	// renv verdict meaningless, and a "use renv" nudge alongside a broken
	// installation is misleading advice.
	const ready = await runItem('environmentReady', producers.ready);
	items.push(ready);
	if (ready.status === 'fail') {
		items.push(skipped('dedicatedEnvironment'));
		return finalize(items);
	}

	items.push(await runItem('dedicatedEnvironment', producers.dedicated));
	return finalize(items);
}
