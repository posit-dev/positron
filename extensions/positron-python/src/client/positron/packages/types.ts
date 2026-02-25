/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';

/**
 * Interface for emitting messages to the Positron console
 */
export interface MessageEmitter {
    fire(message: positron.LanguageRuntimeMessage): void;
}

/**
 * Interface for package managers.
 *
 * Provides package management functionality for Python sessions.
 */
export interface IPackageManager {
    /**
     * Install one or more packages.
     * @param packages Array of package install requests with name and optional version
     */
    installPackages(packages: positron.PackageSpec[]): Promise<void>;

    /**
     * Uninstall one or more packages.
     * @param packages Array of package names to uninstall
     */
    uninstallPackages(packages: string[]): Promise<void>;

    /**
     * Update specific packages to latest versions.
     * @param packages Array of package install requests with name and optional version
     */
    updatePackages(packages: positron.PackageSpec[]): Promise<void>;

    /**
     * Update all installed packages to their latest versions.
     */
    updateAllPackages(): Promise<void>;

    /**
     * Search for packages matching a query.
     * @param query Search query string
     * @returns Array of matching packages
     */
    searchPackages(query: string): Promise<positron.LanguageRuntimePackage[]>;

    /**
     * Search for available versions of a specific package.
     * @param name Package name
     * @returns Array of version strings
     */
    searchPackageVersions(name: string): Promise<string[]>;
}
