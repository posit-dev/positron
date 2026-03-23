/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';

/**
 * Interface for emitting messages to the Positron console
 */
export interface MessageEmitter {
    fire(message: positron.LanguageRuntimeMessage): void;
}

/**
 * Interface for a session that supports RPC method calls.
 */
export interface PackageSession {
    /** Session metadata containing the session ID */
    metadata: { sessionId: string };
    /** Call an RPC method on the session */
    callMethod(method: string, ...args: unknown[]): Thenable<unknown>;
}

/**
 * Interface for package managers.
 *
 * Provides package management functionality for Python sessions.
 */
export interface IPackageManager {
    /**
     * Get list of installed packages.
     * @param token Optional cancellation token
     * @returns Array of installed packages
     */
    getPackages(token?: vscode.CancellationToken): Promise<positron.LanguageRuntimePackage[]>;

    /**
     * Install one or more packages.
     * @param packages Array of package install requests with name and optional version
     * @param token Optional cancellation token
     */
    installPackages(packages: positron.PackageSpec[], token?: vscode.CancellationToken): Promise<void>;

    /**
     * Uninstall one or more packages.
     * @param packages Array of package names to uninstall
     * @param token Optional cancellation token
     */
    uninstallPackages(packages: string[], token?: vscode.CancellationToken): Promise<void>;

    /**
     * Update specific packages to latest versions.
     * @param packages Array of package install requests with name and optional version
     * @param token Optional cancellation token
     */
    updatePackages(packages: positron.PackageSpec[], token?: vscode.CancellationToken): Promise<void>;

    /**
     * Update all installed packages to their latest versions.
     * @param token Optional cancellation token
     */
    updateAllPackages(token?: vscode.CancellationToken): Promise<void>;

    /**
     * Search for packages matching a query.
     * @param query Search query string
     * @param token Optional cancellation token
     * @returns Array of matching packages
     */
    searchPackages(query: string, token?: vscode.CancellationToken): Promise<positron.LanguageRuntimePackage[]>;

    /**
     * Search for available versions of a specific package.
     * @param name Package name
     * @param token Optional cancellation token
     * @returns Array of version strings
     */
    searchPackageVersions(name: string, token?: vscode.CancellationToken): Promise<string[]>;
}
