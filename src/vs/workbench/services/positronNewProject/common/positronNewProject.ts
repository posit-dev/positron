/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const POSITRON_NEW_PROJECT_CONFIG_STORAGE_KEY = 'positron.newProjectConfig';

export const POSITRON_NEW_PROJECT_SERVICE_ID = 'positronNewProjectService';

export const IPositronNewProjectService = createDecorator<IPositronNewProjectService>(POSITRON_NEW_PROJECT_SERVICE_ID);

/**
 * NewProjectConfiguration interface. Defines the configuration for a new project.
 */
export interface NewProjectConfiguration {
	readonly runtimeId: string;
	readonly projectType: string;
	readonly projectFolder: string;
	readonly initGitRepo: boolean;
	readonly pythonEnvType: string;
	readonly installIpykernel: boolean;
	readonly useRenv: boolean;
}

/**
 * IPositronNewProjectService interface.
 */
export interface IPositronNewProjectService {
	/**
	 * For service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Clears the new project configuration from the storage service.
	 */
	clearNewProjectConfig(): void;

	/**
	 * Initializes the new project if applicable. Initialization involves tasks such as starting
	 * the user-selected interpreter, creating the appropriate unsaved new file, initializing the
	 * git repository, etc..
	 * @returns Whether the new project was initialized.
	 */
	initNewProject(): void;

	/**
	 * Stores the new project configuration in the storage service.
	 * @param newProjectConfig The new project configuration to store.
	 */
	storeNewProjectConfig(newProjectConfig: NewProjectConfiguration): void;
}
