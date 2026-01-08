/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { Barrier } from '../../../../base/common/async.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILanguageRuntimeMetadata } from '../../languageRuntime/common/languageRuntimeService.js';

export const POSITRON_NEW_FOLDER_CONFIG_STORAGE_KEY = 'positron.newFolderConfig';

export const POSITRON_NEW_FOLDER_SERVICE_ID = 'positronNewFolderService';

export const IPositronNewFolderService = createDecorator<IPositronNewFolderService>(POSITRON_NEW_FOLDER_SERVICE_ID);

/**
 * NewFolderStartupPhase enum. Defines the phases through which the new folder service progresses as Positron
 * starts.
 */
export enum NewFolderStartupPhase {
	/**
	 * Phase 1: The new folder has not yet been initialized.
	 */
	Initializing = 'initializing',

	/**
	 * Phase 2: The new folder is awaiting trust. If the workspace is not trusted, we cannot proceed with
	 * initialization. The new folder service stays at `AwaitingTrust` until workspace trust is granted.
	 */
	AwaitingTrust = 'awaitingTrust',

	/**
	 * Phase 3: The new folder is running initialization tasks provided by extensions, such as creating the
	 * appropriate unsaved new file, initializing the git repository, etc., and starting the user-selected
	 * interpreter.
	*/
	CreatingFolder = 'creatingFolder',

	/**
	 * Phase 4: The affiliated runtime for the new folder is starting.
	 */
	RuntimeStartup = 'runtimeStartup',

	/**
	 * Phase 5: The new folder is running post-initialization tasks that require the interpreter to be
	 * ready, such as running renv::init() in R.
	 */

	PostInitialization = 'postInitialization',

	/**
	 * Phase 6: The new folder has been initialized.
	 */
	Complete = 'complete',
}

/**
 * FolderTemplate enum. Defines the folder templates that can be created.
 * TODO: localize. Since this is an enum, we can't use the localize function
 * because computed values must be numbers (not strings). So we'll probably need to
 * turn this into an object with keys and values, maybe also using something like
 * satisfies Readonly<Record<string, string>>.
 */
export enum FolderTemplate {
	PythonProject = 'Python Project',
	RProject = 'R Project',
	JupyterNotebook = 'Jupyter Notebook',
	EmptyProject = 'Empty Project'
}

/**
 * NewFolderTask enum. Defines the tasks that can be pending during new folder initialization.
 */
export enum NewFolderTask {
	Python = 'python',
	R = 'r',
	Jupyter = 'jupyter',
	Git = 'git',
	PythonEnvironment = 'pythonEnvironment',
	REnvironment = 'rEnvironment',
	CreateNewFile = 'createNewFile',
	CreatePyprojectToml = 'createPyprojectToml',
}

/**
 * NewFolderConfiguration interface. Defines the configuration for a new folder.
 */
export interface NewFolderConfiguration {
	readonly folderScheme: string;
	readonly folderAuthority: string;
	readonly runtimeMetadata: ILanguageRuntimeMetadata | undefined;
	readonly folderTemplate: string;
	readonly folderPath: string;
	readonly folderName: string;
	readonly initGitRepo: boolean;
	readonly createPyprojectToml: boolean | undefined;
	readonly pythonEnvProviderId: string | undefined;
	readonly pythonEnvProviderName: string | undefined;
	readonly installIpykernel: boolean | undefined;
	readonly condaPythonVersion: string | undefined;
	readonly uvPythonVersion: string | undefined;
	readonly useRenv: boolean | undefined;
	readonly openInNewWindow: boolean;
}

/**
 * IPositronNewFolderService interface.
 */
export interface IPositronNewFolderService {
	/**
	 * For service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Event tracking the current startup phase.
	 */
	onDidChangeNewFolderStartupPhase: Event<NewFolderStartupPhase>;

	/**
	 * The current startup phase.
	 */
	readonly startupPhase: NewFolderStartupPhase;

	/**
	 * Event tracking the pending init tasks.
	 */
	onDidChangePendingInitTasks: Event<Set<string>>;

	/**
	 * Event tracking the pending post-init tasks.
	 */
	onDidChangePostInitTasks: Event<Set<string>>;

	/**
	 * The pending init tasks.
	 */
	readonly pendingInitTasks: Set<string>;

	/**
	 * The pending post-init tasks.
	 */
	readonly pendingPostInitTasks: Set<string>;

	/**
	 * Clears the new folder configuration from the storage service.
	 */
	clearNewFolderConfig(): void;

	/**
	 * Initializes the new folder if applicable. Initialization involves tasks such as starting
	 * the user-selected interpreter, creating the appropriate unsaved new file, initializing the
	 * git repository, etc..
	 * @returns Whether the new folder was initialized.
	 */
	initNewFolder(): Promise<void>;

	/**
	 * Determines whether the current window is the new folder that was just created.
	 * @returns Whether the current window is the newly created folder.
	 */
	isCurrentWindowNewFolder(): boolean;

	/**
	 * Barrier for other services to wait for all init tasks to complete.
	 */
	initTasksComplete: Barrier;

	/**
	 * Barrier for other services to wait for all post-init tasks to complete.
	 */
	postInitTasksComplete: Barrier;

	/**
	 * Returns the metadata for the runtime chosen for the new folder, or
	 * undefined if this isn't a new folder.
	 */
	readonly newFolderRuntimeMetadata: ILanguageRuntimeMetadata | undefined;

	/**
	 * Stores the new folder configuration in the storage service.
	 * @param newFolderConfig The new folder configuration to store.
	 */
	storeNewFolderConfig(newFolderConfig: NewFolderConfiguration): void;
}

/**
 * CreateEnvironmentResult type.
 * Used to capture the result of creating a new environment and registering the interpreter.
 * Based on the result from the Create_Environment_And_Register 'python.createEnvironmentAndRegister'
 * command defined in extensions/positron-python/src/client/pythonEnvironments/creation/createEnvApi.ts.
 */
export type CreateEnvironmentResult = {
	readonly path?: string;
	readonly error?: Error;
	readonly metadata?: ILanguageRuntimeMetadata;
};

/**
 * CreatePyprojectTomlResult type.
 * Used to capture the result of creating a pyproject.toml file in the new folder.
 * Based on the result from the Create_Pyproject_Toml 'python.createPyprojectToml'
 * command defined in extensions/positron-python/src/client/common/application/commands/createPyprojectToml.ts.
 */
export type CreatePyprojectTomlResult = { success: true; path: string } | { success: false; error: string };

/**
 * LanguageIds enum.
 */
export enum LanguageIds {
	// Defined in extensions/positron-python/src/client/common/constants.ts "PYTHON_LANGUAGE"
	Python = 'python',
	// Defined in extensions/positron-r/src/provider.ts makeMetadata()
	R = 'r'
}
