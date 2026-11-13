/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as positron from 'positron';

/** Another copy of a package that the kernel's import path shadows. */
export interface ShadowedCopy {
    version: string;
    location?: string;
}

/** A package entry as the kernel's `getPackagesInstalled` reports it. */
export interface KernelPackageEntry extends positron.LanguageRuntimePackage {
    /** The import path entry that holds the copy the kernel imports. */
    location?: string;
    /** Later copies of the same package that the imported copy shadows, in import path order. */
    shadowed?: ShadowedCopy[];
}

/**
 * Mark the packages whose imported copy comes from Positron's bundled ipykernel
 * paths, and record the version the user's environment also has, if any.
 * Strips the kernel-only `location` and `shadowed` fields from the result.
 */
export function classifyPackages(
    entries: KernelPackageEntry[],
    bundlePaths: readonly string[] | undefined,
    platform: NodeJS.Platform = process.platform,
): positron.LanguageRuntimePackage[] {
    const isBundled = bundledPathMatcher(bundlePaths ?? [], platform);
    return entries.map(({ location, shadowed, ...pkg }) => {
        if (!isBundled(location)) {
            return pkg;
        }
        const environmentCopy = shadowed?.find((copy) => !isBundled(copy.location));
        return environmentCopy
            ? { ...pkg, bundled: true, environmentVersion: environmentCopy.version }
            : { ...pkg, bundled: true };
    });
}

/**
 * The names of the packages installed in the user's environment: every package
 * except the ones only Positron's bundle provides.
 */
export function environmentPackageNames(packages: positron.LanguageRuntimePackage[]): string[] {
    return packages.filter((pkg) => !pkg.bundled || pkg.environmentVersion !== undefined).map((pkg) => pkg.name);
}

function bundledPathMatcher(
    bundlePaths: readonly string[],
    platform: NodeJS.Platform,
): (location: string | undefined) => boolean {
    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    // Python and Node can disagree on drive-letter case for the same Windows path.
    const normalize = (p: string) => {
        const resolved = pathApi.resolve(p);
        return platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const roots = bundlePaths.map(normalize);
    return (location) => {
        if (!location) {
            return false;
        }
        const candidate = normalize(location);
        return roots.some((root) => candidate === root || candidate.startsWith(root + pathApi.sep));
    };
}
