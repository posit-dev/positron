/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

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
	 * Phase 4: The new project has been initialized.
	 */
	Complete = 'complete'
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
	REnvironment = 'rEnvironment'
}

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
	 * Event tracking the current startup phase.
	 */
	onDidChangeNewProjectStartupPhase: Event<NewProjectStartupPhase>;

	/**
	 * The current startup phase.
	 */
	readonly startupPhase: NewProjectStartupPhase;

	/**
	 * Event tracking the pending tasks.
	 */
	onDidChangePendingTasks: Event<Set<string>>;

	/**
	 * The pending tasks.
	 */
	readonly pendingTasks: Set<string>;

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
	 * Stores the new project configuration in the storage service.
	 * @param newProjectConfig The new project configuration to store.
	 */
	storeNewProjectConfig(newProjectConfig: NewProjectConfiguration): void;
}
