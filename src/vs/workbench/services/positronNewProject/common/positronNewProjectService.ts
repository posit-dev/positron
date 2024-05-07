/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ISettableObservable, observableValue } from 'vs/base/common/observable';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { IPositronNewProjectService, NewProjectConfiguration, NewProjectStartupPhase, NewProjectTask, POSITRON_NEW_PROJECT_CONFIG_STORAGE_KEY } from 'vs/workbench/services/positronNewProject/common/positronNewProject';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IRuntimeStartupService, RuntimeStartupPhase } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { Event } from 'vs/base/common/event';

/**
 * PositronNewProjectService class.
 */
export class PositronNewProjectService extends Disposable implements IPositronNewProjectService {
	declare readonly _serviceBrand: undefined;

	// New Project configuration
	private _newProjectConfig: NewProjectConfiguration | null;

	// New Project startup phase tracking
	private _startupPhase: ISettableObservable<NewProjectStartupPhase>;
	onDidChangeNewProjectStartupPhase: Event<NewProjectStartupPhase>;

	// Pending tasks tracking
	private _pendingTasks: ISettableObservable<Set<string>>;
	onDidChangePendingTasks: Event<Set<string>>;

	// Create the Positron New Project service instance.
	constructor(
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@ICommandService private readonly _commandService: ICommandService,
		@ILogService private readonly _logService: ILogService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IRuntimeStartupService private readonly _runtimeStartupService: IRuntimeStartupService,
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService
	) {
		super();

		// Initialize the new project startup phase observable
		this._startupPhase = observableValue(
			'new-project-startup-phase',
			NewProjectStartupPhase.Initializing
		);
		this.onDidChangeNewProjectStartupPhase = Event.fromObservable(
			this._startupPhase
		);
		this._register(
			this.onDidChangeNewProjectStartupPhase(() => {
				this._logService.debug(
					`[New project startup] Phase changed to ${this._startupPhase}`
				);
			})
		);

		// Parse the new project configuration from the storage service
		this._newProjectConfig = this.parseNewProjectConfig();

		// Initialize the pending tasks observable.
		// This initialization needs to take place after the new project configuration is parsed, so
		// that the tasks can be determined based on the configuration.
		this._pendingTasks = observableValue(
			'new-project-pending-tasks',
			this.getTasks()
		);
		this.onDidChangePendingTasks = Event.fromObservable(this._pendingTasks);
		this._register(
			this.onDidChangePendingTasks((pendingTasks) => {
				// If there are no pending tasks, the new project startup is complete
				if (pendingTasks.size === 0) {
					this._startupPhase.set(
						NewProjectStartupPhase.Complete,
						undefined
					);
				}
			})
		);
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
			this._logService.debug(
				'No new project configuration found in storage'
			);
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
		const currentFolderPath =
			this._contextService.getWorkspace().folders[0].uri.fsPath;
		return newProjectPath === currentFolderPath;
	}

	/**
	 * Runs tasks that require the extension service to be ready.
	 */
	private async runExtensionTasks() {
		if (this.pendingTasks.has(NewProjectTask.Python)) {
			this.runPythonTasks();
		}

		if (this.pendingTasks.has(NewProjectTask.Jupyter)) {
			this.runJupyterTasks();
		}

		if (this.pendingTasks.has(NewProjectTask.R)) {
			this.runRTasks();
		}

		if (this.pendingTasks.has(NewProjectTask.Git)) {
			this.runGitInit();
		}
	}

	/**
	 * Runs Python Project specific tasks.
	 * Relies on extension ms-python.python
	 */
	private runPythonTasks() {
		if (this.pendingTasks.has(NewProjectTask.PythonEnvironment)) {
			this.createPythonEnvironment();
		}

		this._commandService
			.executeCommand('python.createNewFile')
			.then(() => this.removePendingTask(NewProjectTask.Python));
	}

	/**
	 * Runs Jupyter Notebook specific tasks.
	 * Relies on extension vscode.ipynb
	 */
	private runJupyterTasks() {
		if (this.pendingTasks.has(NewProjectTask.PythonEnvironment)) {
			this.createPythonEnvironment();
		}

		this._commandService
			.executeCommand('ipynb.newUntitledIpynb')
			.then(() => this.removePendingTask(NewProjectTask.Jupyter));
	}

	/**
	 * Runs R Project specific tasks.
	 * Relies on extension vscode.positron-r
	 */
	private runRTasks() {
		if (this.pendingTasks.has(NewProjectTask.REnvironment)) {
			this.createREnvironment();
		}

		this._commandService
			.executeCommand('r.createNewFile')
			.then(() => this.removePendingTask(NewProjectTask.R));
	}

	/**
	 * Runs the git init command.
	 * Relies on extension vscode.git
	 */
	private runGitInit() {
		// TODO: This command works, but requires a quick pick selection
		// this._commandService.executeCommand('git.init');

		// TODO: create .gitignore and README.md
		this.removePendingTask(NewProjectTask.Git);
	}

	/**
	 * Creates the Python environment.
	 * Relies on extension ms-python.python
	 */
	private createPythonEnvironment() {
		const pythonEnvType = this._newProjectConfig?.pythonEnvType;
		if (pythonEnvType && pythonEnvType.length > 0) {
			// TODO: create the .venv/.conda/etc. as appropriate
		}
		this.removePendingTask(NewProjectTask.PythonEnvironment);
	}

	/**
	 * Creates the R environment.
	 * Relies on extension vscode.positron-r
	 */
	private createREnvironment() {
		// TODO: run renv::init()
		this.removePendingTask(NewProjectTask.REnvironment);
	}

	async initNewProject() {
		if (!this.isCurrentWindowNewProject()) {
			return;
		}
		if (this._newProjectConfig) {
			// We're in the new project window, so we can clear the config from the storage service.
			this.clearNewProjectConfig();

			this._startupPhase.set(
				NewProjectStartupPhase.AwaitingTrust,
				undefined
			);

			// Ensure the workspace is trusted before proceeding with new project tasks
			if (this._workspaceTrustManagementService.isWorkspaceTrusted()) {
				this.newProjectTasks();
			} else {
				this._register(
					this._workspaceTrustManagementService.onDidChangeTrust(
						(trusted) => {
							if (!trusted) {
								return;
							}
							if (
								this.startupPhase ===
								NewProjectStartupPhase.AwaitingTrust
							) {
								// Trust was granted. Now we can proceed with the new project tasks.
								this.newProjectTasks();
							}
						}
					)
				);
			}
		} else {
			this._logService.error(
				'[New project startup] No new project configuration found'
			);
			this._startupPhase.set(NewProjectStartupPhase.Complete, undefined);
		}
	}

	/**
	 * Runs the tasks for the new project.
	 */
	private newProjectTasks() {
		if (!this.isCurrentWindowNewProject()) {
			return;
		}
		this._startupPhase.set(
			NewProjectStartupPhase.CreatingProject,
			undefined
		);
		if (this._newProjectConfig) {
			// Start the selected runtime
			const runtimeId = this._newProjectConfig.runtimeId;
			this._register(
				this._runtimeStartupService.onDidChangeRuntimeStartupPhase(
					(phase) => {
						if (phase === RuntimeStartupPhase.Discovering) {
							// Run tasks that use extensions. At this point, extensions should be ready,
							// and extensions that contribute language runtimes should have been
							// activated as well.
							this.runExtensionTasks();
						} else if (phase === RuntimeStartupPhase.Complete) {
							// Thought: Can the interpreter discovery at startup be modified to directly use the
							// selected interpreter, so that the user doesn't have to wait for the interpreter
							// discovery to complete before the runtime is started? Can we set the affiliated
							// runtime metadata directly, so the selected interpreter can be started immediately
							// without having to explicitly select it?

							// TODO: this may try to start a runtime that is already running. This may also
							// cause the active interpreter to be changed in other windows.
							this._runtimeSessionService.selectRuntime(
								runtimeId,
								'User-requested startup from the Positron Project Wizard during project initialization'
							);
						}
					}
				)
			);
		} else {
			this._logService.error(
				'[New project startup] No new project configuration found'
			);
			this._startupPhase.set(NewProjectStartupPhase.Complete, undefined);
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

	/**
	 * Returns the current startup phase.
	 */
	get startupPhase(): NewProjectStartupPhase {
		return this._startupPhase.get();
	}

	/**
	 * Returns the pending tasks.
	 */
	get pendingTasks(): Set<string> {
		return this._pendingTasks.get();
	}

	/**
	 * Removes a pending task.
	 */
	private removePendingTask(task: NewProjectTask) {
		this.pendingTasks.delete(task);
		this._pendingTasks.set(this.pendingTasks, undefined);
	}

	/**
	 * Returns the tasks that need to be performed for the new project.
	 */
	private getTasks(): Set<NewProjectTask> {
		if (!this._newProjectConfig) {
			return new Set();
		}

		const tasks = new Set<NewProjectTask>();
		// TODO: use enum values instead of strings
		switch (this._newProjectConfig.projectType) {
			case 'Python Project':
				tasks.add(NewProjectTask.Python);
				break;
			case 'Jupyter Notebook':
				tasks.add(NewProjectTask.Jupyter);
			case 'R Project':
				tasks.add(NewProjectTask.R);
		}

		if (this._newProjectConfig.initGitRepo) {
			tasks.add(NewProjectTask.Git);
		}

		if (this._newProjectConfig.pythonEnvType) {
			tasks.add(NewProjectTask.PythonEnvironment);
		}

		if (this._newProjectConfig.useRenv) {
			tasks.add(NewProjectTask.REnvironment);
		}

		return tasks;
	}
}
