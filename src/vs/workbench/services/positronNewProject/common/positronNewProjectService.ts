/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';

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

const POSITRON_NEW_PROJECT_CONFIG_STORAGE_KEY = 'positron.newProjectConfig';
const POSITRON_NEW_PROJECT_SERVICE_ID = 'positronNewProjectService';

export const IPositronNewProjectService = createDecorator<IPositronNewProjectService>(POSITRON_NEW_PROJECT_SERVICE_ID);

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
	initNewProject(): boolean;

	/**
	 * Determines whether the current window the new project that was just created.
	 * @returns Whether the current window is the newly created project.
	 */
	isCurrentWindowNewProject(): boolean;

	/**
	 * Stores the new project configuration in the storage service.
	 * @param newProjectConfig The new project configuration to store.
	 */
	storeNewProjectConfig(newProjectConfig: NewProjectConfiguration): void;
}

/**
 * PositronNewProjectService class.
 */
export class PositronNewProjectService extends Disposable implements IPositronNewProjectService {
	declare readonly _serviceBrand: undefined;
	private _newProjectConfig: NewProjectConfiguration | null;

	// Create the Positron New Project service instance.
	constructor(
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@ILogService private readonly _logService: ILogService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();
		this._newProjectConfig = this.parseNewProjectConfig();
	}

	/**
	 * Parses the new project configuration from the storage service and returns it.
	 * @returns The new project configuration.
	 */
	private parseNewProjectConfig(): NewProjectConfiguration | null {
		const newProjectConfigStr = this._storageService.get(
			POSITRON_NEW_PROJECT_CONFIG_STORAGE_KEY,
			StorageScope.APPLICATION
		);
		if (!newProjectConfigStr) {

			this._logService.warn('No new project configuration found in storage');
			return null;
		}
		return JSON.parse(newProjectConfigStr) as NewProjectConfiguration;
	}

	isCurrentWindowNewProject() {
		if (!this._newProjectConfig) {
			return false;
		}
		const newProjectPath = this._newProjectConfig.projectFolder;
		const currentFolderPath = this._contextService.getWorkspace().folders[0].uri.fsPath;
		return newProjectPath === currentFolderPath;
	}

	initNewProject() {
		if (this.isCurrentWindowNewProject()) {
			return true;
		}
		return false;
	}

	clearNewProjectConfig() {
		this._storageService.remove(
			POSITRON_NEW_PROJECT_CONFIG_STORAGE_KEY,
			StorageScope.APPLICATION
		);
	}

	storeNewProjectConfig(newProjectConfig: NewProjectConfiguration) {
		this._storageService.store(
			POSITRON_NEW_PROJECT_CONFIG_STORAGE_KEY,
			JSON.stringify(newProjectConfig),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE
		);
	}
}
