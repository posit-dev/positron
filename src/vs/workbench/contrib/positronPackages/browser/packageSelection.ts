/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimePackage } from '../../../services/runtimeSession/common/runtimeSessionService.js';

/**
 * A package can be updated when it is outdated and a latest version is known.
 */
export function isPackageUpdatable(pkg: ILanguageRuntimePackage): boolean {
	return pkg.outdated === true && !!pkg.latestVersion;
}

/**
 * Returns the updatable packages whose names (case-insensitive) are in `names`,
 * preserving the order of `packages`.
 */
export function getUpdatablePackages(packages: readonly ILanguageRuntimePackage[], names: readonly string[]): ILanguageRuntimePackage[] {
	const wanted = new Set(names.map(name => name.toLowerCase()));
	return packages.filter(pkg => wanted.has(pkg.name.toLowerCase()) && isPackageUpdatable(pkg));
}

/**
 * Update is available for a single selection, or for a multi-selection that
 * contains at least one updatable package.
 */
export function canUpdateSelection(count: number, hasUpdatable: boolean): boolean {
	return count === 1 || (count >= 2 && hasUpdatable);
}

/**
 * Uninstall is available for any non-empty selection.
 */
export function canUninstallSelection(count: number): boolean {
	return count >= 1;
}
