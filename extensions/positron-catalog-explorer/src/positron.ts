/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type * as positronApi from 'positron';

export type PositronApi = typeof positronApi;

declare global {
	function acquirePositronApi(): PositronApi;
}

export function getPositronAPI(): PositronApi | undefined {
	if (typeof globalThis?.acquirePositronApi !== 'function') {
		return;
	}
	return globalThis.acquirePositronApi();
}

/**
 * Ensures that a given set of packages are installed in a Positron session.
 */
export async function ensureDependencies(
	session: positronApi.LanguageRuntimeSession,
	packages: string[],
): Promise<boolean> {
	const positron = getPositronAPI();
	if (!positron) {
		throw new Error('Not running in Positron');
	}
	if (session.runtimeMetadata.languageId !== 'r') {
		// Only R supports package installation.
		return true;
	}
	// Adapted from code in positron-connections.
	const missing = [];
	for (const pkg of packages) {
		if (!(await session.callMethod?.('is_installed', pkg))) {
			missing.push(pkg);
		}
	}
	if (missing.length === 0) {
		return true;
	}
	const lang =
		session.runtimeMetadata.languageId.charAt(0).toUpperCase() +
		session.runtimeMetadata.languageId.slice(1);
	const pkgList = missing.join(', ');
	const allow = await positron.window.showSimpleModalDialogPrompt(
		'Installing dependencies',
		`The following ${lang} packages are required: ${pkgList}. Would you like to install them now?`,
	);
	if (!allow) {
		return false;
	}
	for (const pkg of missing) {
		if (!(await session.callMethod?.('install_packages', pkg))) {
			throw new Error(`Failed to install package: ${pkg}`);
		}
	}
	return true;
}
