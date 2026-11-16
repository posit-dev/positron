/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ILanguageRuntimePackage, isBundledOnly } from '../../../services/runtimeSession/common/runtimeSessionService.js';

/**
 * A package can be updated when it is outdated, a latest version is known, and the user's
 * environment has a copy of it (a package only Positron's bundle provides has nothing to update).
 */
export function isPackageUpdatable(pkg: ILanguageRuntimePackage): boolean {
	return pkg.outdated === true && !!pkg.latestVersion && !isBundledOnly(pkg);
}

/**
 * A package can be uninstalled unless only Positron's bundle provides it, in which case the
 * user's environment has no copy to remove.
 */
export function isPackageUninstallable(pkg: ILanguageRuntimePackage): boolean {
	return !isBundledOnly(pkg);
}

/**
 * Returns the packages whose names (case-insensitive) are in `names`, preserving the order of
 * `packages`.
 */
export function getSelectedPackages(packages: readonly ILanguageRuntimePackage[], names: readonly string[]): ILanguageRuntimePackage[] {
	const wanted = new Set(names.map(name => name.toLowerCase()));
	return packages.filter(pkg => wanted.has(pkg.name.toLowerCase()));
}

/**
 * Returns the updatable packages whose names (case-insensitive) are in `names`,
 * preserving the order of `packages`.
 */
export function getUpdatablePackages(packages: readonly ILanguageRuntimePackage[], names: readonly string[]): ILanguageRuntimePackage[] {
	return getSelectedPackages(packages, names).filter(isPackageUpdatable);
}

/**
 * Returns the uninstallable packages whose names (case-insensitive) are in `names`,
 * preserving the order of `packages`.
 */
export function getUninstallablePackages(packages: readonly ILanguageRuntimePackage[], names: readonly string[]): ILanguageRuntimePackage[] {
	return getSelectedPackages(packages, names).filter(isPackageUninstallable);
}

/**
 * With one package selected, Update is available unless only Positron's bundle provides it (it
 * opens a version picker, so the package need not be outdated). With several, it is available
 * when at least one of them is updatable; the rest are skipped.
 */
export function canUpdateSelection(items: readonly ILanguageRuntimePackage[]): boolean {
	return items.length === 1 ? isPackageUninstallable(items[0]) : items.some(isPackageUpdatable);
}

/**
 * Uninstall is available when at least one selected package can be uninstalled; packages only
 * Positron's bundle provides are skipped.
 */
export function canUninstallSelection(items: readonly ILanguageRuntimePackage[]): boolean {
	return items.some(isPackageUninstallable);
}

/**
 * Label for copying a multi-package selection. Only used for two or more
 * packages; a single package has its own, more specific entry.
 */
export function copyPackagesLabel(count: number): string {
	return localize('positronPackages.copyNPackages', "Copy {0} Packages", count);
}
