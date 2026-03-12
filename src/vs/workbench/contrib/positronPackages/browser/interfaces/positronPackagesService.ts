/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILanguageRuntimePackage, ILanguageRuntimeSession, IPackageSpec } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronPackagesInstance } from '../positronPackagesInstance.js';

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

	/**
	 * The onDidRefreshPackagesInstance event.
	 */
	readonly onDidChangeActivePackagesInstance: Event<IPositronPackagesInstance | undefined>;

	readonly onDidStopPackagesInstance: Event<IPositronPackagesInstance>;

	setActivePositronPackagesSession(session: ILanguageRuntimeSession): unknown;

	/**
	 * Gets the installed packages for the active session.
	 * @param token Optional cancellation token
	 */
	refreshPackages(token?: CancellationToken): Promise<ILanguageRuntimePackage[]>;

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
	 */
	updateAllPackages(token?: CancellationToken): Promise<void>;

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
