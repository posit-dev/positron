/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { ILanguageRuntimeMetadata } from '../../languageRuntime/common/languageRuntimeService.js';
import { Barrier } from '../../../../base/common/async.js';

export const POSITRON_NEW_PROJECT_CONFIG_STORAGE_KEY = 'positron.newProjectConfig';

export const POSITRON_NEW_PROJECT_SERVICE_ID = 'positronNewProjectService';

export const IPositronNewProjectService = createDecorator<IPositronNewProjectService>(POSITRON_NEW_PROJECT_SERVICE_ID);

/**
 * NewProjectStartupPhase enum. Defines the phases through which the new project service progresses as Positron
 * starts.
 */
export enum NewProjectStartupPhase {
	/**
	 * Phase 1: The new project has not yet been initialized.
	 */
	Initializing = 'initializing',

	/**
	 * Phase 2: The new project is awaiting trust. If the workspace is not trusted, we cannot proceed with
	 * initialization. The new project service stays at `AwaitingTrust` until workspace trust is granted.
	 */
	AwaitingTrust = 'awaitingTrust',

	/**
	 * Phase 3: The new project is running initialization tasks provided by extensions, such as creating
	 * the appropriate unsaved new file, initializing the git repository, etc., and starting the user-selected
	 * interpreter.
	*/
	CreatingProject = 'creatingProject',

	/**
	 * Phase 4: The affiliated runtime for the new project is starting.
	 */
	RuntimeStartup = 'runtimeStartup',

	/**
	 * Phase 5: The new project is running post-initialization tasks that require the interpreter to be
	 * ready, such as running renv::init() in R projects.
	 */

	PostInitialization = 'postInitialization',
	/**
	 * Phase 6: The new project has been initialized.
	 */
	Complete = 'complete',
}

/**
 * NewProjectType enum. Defines the types of projects that can be created.
 * TODO: localize. Since this is an enum, we can't use the localize function
 * because computed values must be numbers (not strings). So we'll probably need to
 * turn this into an object with keys and values, maybe also using something like
 * satisfies Readonly<Record<string, string>>.
 */
export enum NewProjectType {
	PythonProject = 'Python Project',
	RProject = 'R Project',
	JupyterNotebook = 'Jupyter Notebook'
}

/**
 * NewProjectTask enum. Defines the tasks that can be pending during new project initialization.
 */
export enum NewProjectTask {
	Python = 'python',
	R = 'r',
	Jupyter = 'jupyter',
	Git = 'git',
	PythonEnvironment = 'pythonEnvironment',
	REnvironment = 'rEnvironment',
	CreateNewFile = 'createNewFile',
}

/**
 * NewProjectConfiguration interface. Defines the configuration for a new project.
 */
export interface NewProjectConfiguration {
	readonly folderScheme: string;
	readonly folderAuthority: string;
	readonly runtimeMetadata: ILanguageRuntimeMetadata | undefined;
	readonly projectType: string;
	readonly projectFolder: string;
	readonly projectName: string;
	readonly initGitRepo: boolean;
	readonly pythonEnvProviderId: string | undefined;
	readonly pythonEnvProviderName: string | undefined;
	readonly installIpykernel: boolean | undefined;
	readonly condaPythonVersion: string | undefined;
	readonly useRenv: boolean | undefined;
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
	 * Event tracking the current startup phase.
	 */
	onDidChangeNewProjectStartupPhase: Event<NewProjectStartupPhase>;

	/**
	 * The current startup phase.
	 */
	readonly startupPhase: NewProjectStartupPhase;

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
	 * Clears the new project configuration from the storage service.
	 */
	clearNewProjectConfig(): void;

	/**
	 * Initializes the new project if applicable. Initialization involves tasks such as starting
	 * the user-selected interpreter, creating the appropriate unsaved new file, initializing the
	 * git repository, etc..
	 * @returns Whether the new project was initialized.
	 */
	initNewProject(): Promise<void>;

	/**
	 * Determines whether the current window the new project that was just created.
	 * @returns Whether the current window is the newly created project.
	 */
	isCurrentWindowNewProject(): boolean;

	/**
	 * Barrier for other services to wait for all init tasks to complete.
	 */
	initTasksComplete: Barrier;

	/**
	 * Barrier for other services to wait for all post-init tasks to complete.
	 */
	postInitTasksComplete: Barrier;

	/**
	 * Returns the metadata for the runtime chosen for the new project, or
	 * undefined if this isn't a new project.
	 */
	readonly newProjectRuntimeMetadata: ILanguageRuntimeMetadata | undefined;

	/**
	 * Stores the new project configuration in the storage service.
	 * @param newProjectConfig The new project configuration to store.
	 */
	storeNewProjectConfig(newProjectConfig: NewProjectConfiguration): void;
}

/**
 * CreateEnvironmentOptions type.
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
 * LanguageIds enum.
 */
export enum LanguageIds {
	// Defined in extensions/positron-python/src/client/common/constants.ts "PYTHON_LANGUAGE"
	Python = 'python',
	// Defined in extensions/positron-r/src/provider.ts makeMetadata()
	R = 'r'
}
