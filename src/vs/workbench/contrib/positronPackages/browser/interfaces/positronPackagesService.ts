/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILanguageRuntimePackage, ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronPackagesInstance } from '../positronPackagesInstance.js';

// Create the decorator for the Positron variables service (used in dependency injection).
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
	 * Gets the installed packages for the given session ID.
	 *
	 * @param sessionId
	 */
	refreshPackages(): Promise<ILanguageRuntimePackage[]>;

	installPackages(packages: string[]): Promise<void>;

	uninstallPackages(packages: string[]): Promise<void>;

	updatePackages(packages: string[]): Promise<void>;

	updateAllPackages(): Promise<void>;

	searchPackages(query: string): Promise<ILanguageRuntimePackage[]>;

	searchPackageVersions(name: string): Promise<string[]>;

	getInstances(): IPositronPackagesInstance[];
}
