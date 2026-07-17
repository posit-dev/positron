/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILanguageRuntimePackage, ILanguageRuntimeSession, IPackageSpec } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronPackagesInstance } from '../positronPackagesInstance.js';
import { PackagesItemSize } from '../positronPackagesContextKeys.js';

// Create the decorator for the Positron packages service (used in dependency injection).
export const IPositronPackagesService = createDecorator<IPositronPackagesService>('positronPackagesService');

/**
 * IPositronPackagesService interface.
 */
export interface IPositronPackagesService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	readonly activeSession: ILanguageRuntimeSession | undefined;

	readonly activePackagesInstance: IPositronPackagesInstance | undefined;

	/**
	 * The currently selected package name in the packages view, if any.
	 */
	readonly selectedPackage: string | undefined;

	/**
	 * Sets the currently selected package.
	 * @param packageName The package name, or undefined to clear selection
	 */
	setSelectedPackage(packageName: string | undefined): void;

	/**
	 * The current item size mode for the packages list.
	 */
	readonly itemSize: PackagesItemSize;

	/**
	 * Sets the item size mode for the packages list.
	 */
	setItemSize(itemSize: PackagesItemSize): void;

	/**
	 * Fired when the item size mode changes.
	 */
	readonly onDidChangeItemSize: Event<PackagesItemSize>;

	/**
	 * The onDidRefreshPackagesInstance event.
	 */
	readonly onDidChangeActivePackagesInstance: Event<IPositronPackagesInstance | undefined>;

	readonly onDidStopPackagesInstance: Event<IPositronPackagesInstance>;

	setActivePositronPackagesSession(session: ILanguageRuntimeSession): unknown;

	/**
	 * Gets the installed packages for the active session.
	 * @param token Optional cancellation token
	 * @param forceMetadata When `true`, recompute outdated metadata live for
	 * every package instead of reusing still-fresh cached state. Set for
	 * user-initiated refreshes so an explicit Refresh is always authoritative.
	 */
	refreshPackages(token?: CancellationToken, forceMetadata?: boolean): Promise<ILanguageRuntimePackage[]>;

	/**
	 * Install packages in the active session.
	 * @param packages Array of package specifications to install
	 * @param token Optional cancellation token
	 */
	installPackages(packages: IPackageSpec[], token?: CancellationToken): Promise<void>;

	/**
	 * Uninstall packages from the active session.
	 * @param packageNames Array of package names to uninstall
	 * @param token Optional cancellation token
	 */
	uninstallPackages(packageNames: string[], token?: CancellationToken): Promise<void>;

	/**
	 * Update packages in the active session.
	 * @param packages Array of package specifications to update
	 * @param token Optional cancellation token
	 */
	updatePackages(packages: IPackageSpec[], token?: CancellationToken): Promise<void>;

	/**
	 * Update all packages in the active session.
	 * @param token Optional cancellation token
	 * @returns The names of the packages whose installed version actually
	 * changed, sorted alphabetically. Empty when nothing was updated.
	 */
	updateAllPackages(token?: CancellationToken): Promise<string[]>;

	/**
	 * Search for packages matching a query.
	 * @param query Search query
	 * @param token Optional cancellation token
	 */
	searchPackages(query: string, token?: CancellationToken): Promise<ILanguageRuntimePackage[]>;

	/**
	 * Search for available versions of a package.
	 * @param name Package name
	 * @param token Optional cancellation token
	 */
	searchPackageVersions(name: string, token?: CancellationToken): Promise<string[]>;

	getInstances(): IPositronPackagesInstance[];
}
