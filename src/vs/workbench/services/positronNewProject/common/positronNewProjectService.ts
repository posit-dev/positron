/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IPositronNewProjectService, NewProjectConfiguration, POSITRON_NEW_PROJECT_CONFIG_STORAGE_KEY } from 'vs/workbench/services/positronNewProject/common/positronNewProject';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IRuntimeStartupService, RuntimeStartupPhase } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';

/**
 * PositronNewProjectService class.
 */
export class PositronNewProjectService extends Disposable implements IPositronNewProjectService {
	declare readonly _serviceBrand: undefined;
	private _newProjectConfig: NewProjectConfiguration | null;

	// Create the Positron New Project service instance.
	constructor(
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@ICommandService private readonly _commandService: ICommandService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILogService private readonly _logService: ILogService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IRuntimeStartupService private readonly _runtimeStartupService: IRuntimeStartupService,
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
			this._logService.debug('No new project configuration found in storage');
			return null;
		}
		return JSON.parse(newProjectConfigStr) as NewProjectConfiguration;
	}

	/**
	 * Determines whether the current window the new project that was just created.
	 * @returns Whether the current window is the newly created project.
	 */
	private isCurrentWindowNewProject() {
		// There is no new project configuration, so a new project was not created.
		if (!this._newProjectConfig) {
			return false;
		}
		const newProjectPath = this._newProjectConfig.projectFolder;
		const currentFolderPath = this._contextService.getWorkspace().folders[0].uri.fsPath;
		return newProjectPath === currentFolderPath;
	}

	/**
	 * Runs tasks that require the extension service to be ready.
	 */
	private runExtensionTasks() {
		if (!this._newProjectConfig) {
			return;
		}

		this._extensionService.whenInstalledExtensionsRegistered().then(() => {
			const projectConfig = this._newProjectConfig!;

			// Run project type specific tasks
			// TODO: use enum for projectType
			switch (projectConfig.projectType) {
				case 'Python Project':
					this.runPythonTasks();
					break;
				case 'Jupyter Notebook':
					this.runJupyterTasks();
					break;
				case 'R Project':
					this.runRTasks();
					break;
			}

			// Initialize git if applicable
			if (projectConfig.initGitRepo) {
				this.runGitInit();
			}
		});
	}

	/**
	 * Runs Python Project specific tasks.
	 */
	private runPythonTasks() {
		this.createPythonEnvironment();
		this._commandService.executeCommand('python.createNewFile');
	}

	/**
	 * Runs Jupyter Notebook specific tasks.
	 */
	private runJupyterTasks() {
		this.createPythonEnvironment();
		this._commandService.executeCommand('ipynb.newUntitledIpynb');
	}

	/**
	 * Runs R Project specific tasks.
	 */
	private runRTasks() {
		this._commandService.executeCommand('r.createNewFile');
		if (this._newProjectConfig?.useRenv) {
			this.createREnvironment();
		}
	}

	/**
	 * Runs the git init command.
	 */
	private runGitInit() {
		// TODO: This command works, but requires a quick pick selection
		// this._commandService.executeCommand('git.init');

		// TODO: create .gitignore and README.md
	}

	/**
	 * Creates the Python environment.
	 */
	private createPythonEnvironment() {
		const pythonEnvType = this._newProjectConfig?.pythonEnvType;
		if (pythonEnvType && pythonEnvType.length > 0) {
			// TODO: create the .venv/.conda/etc. as appropriate
		}
	}

	/**
	 * Creates the R environment.
	 */
	private createREnvironment() {
		// TODO: run renv::init()
	}

	initNewProject() {
		if (this._newProjectConfig && this.isCurrentWindowNewProject()) {
			// We're in the new project window, so we can clear the config from the storage service.
			this.clearNewProjectConfig();

			// Run tasks that require the extension service to be ready.
			this.runExtensionTasks();

			// Start the selected runtime
			const runtimeId = this._newProjectConfig.runtimeId;
			this._register(this._runtimeStartupService.onDidChangeRuntimeStartupPhase(phase => {
				// Thought: Can the interpreter discovery at startup be modified to directly use the
				// selected interpreter, so that the user doesn't have to wait for the interpreter
				// discovery to complete before the runtime is started? Can we set the affiliated
				// runtime metadata directly, so the selected interpreter can be started immediately
				// without having to explicitly select it?
				if (phase === RuntimeStartupPhase.Complete) {
					// TODO: this may try to start a runtime that is already running
					this._runtimeSessionService.selectRuntime(
						runtimeId,
						'User-requested startup from the Positron Project Wizard during project initialization'
					);
				}
			}));
		}
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
