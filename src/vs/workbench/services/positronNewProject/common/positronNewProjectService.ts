/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ISettableObservable, observableValue } from '../../../../base/common/observable.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { CreateEnvironmentResult, IPositronNewProjectService, NewProjectConfiguration, NewProjectStartupPhase, NewProjectTask, NewProjectType, POSITRON_NEW_PROJECT_CONFIG_STORAGE_KEY } from './positronNewProject.js';
import { Event } from '../../../../base/common/event.js';
import { Barrier } from '../../../../base/common/async.js';
import { ILanguageRuntimeMetadata } from '../../languageRuntime/common/languageRuntimeService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath, relativePath } from '../../../../base/common/resources.js';
import { DOT_IGNORE_JUPYTER, DOT_IGNORE_PYTHON, DOT_IGNORE_R } from './positronNewProjectTemplates.js';
import { URI } from '../../../../base/common/uri.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { localize } from '../../../../nls.js';
import { IRuntimeSessionService } from '../../runtimeSession/common/runtimeSessionService.js';

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

	// Pending init tasks tracking
	private _pendingInitTasks: ISettableObservable<Set<string>>;
	onDidChangePendingInitTasks: Event<Set<string>>;

	// Pending post-initialization tasks tracking
	private _pendingPostInitTasks: ISettableObservable<Set<string>>;
	onDidChangePostInitTasks: Event<Set<string>>;

	// Barrier to signal that all initialization tasks are complete
	public initTasksComplete: Barrier = new Barrier();

	// Barrier to signal that all post-initialization tasks are complete
	public postInitTasksComplete: Barrier = new Barrier();

	// Runtime metadata for the new project
	private _runtimeMetadata: ILanguageRuntimeMetadata | undefined;

	// Create the Positron New Project service instance.
	constructor(
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@ICommandService private readonly _commandService: ICommandService,
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService,
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
			this.onDidChangeNewProjectStartupPhase((phase) => {
				switch (phase) {
					case NewProjectStartupPhase.RuntimeStartup:
						this.initTasksComplete.open();
						break;
					case NewProjectStartupPhase.PostInitialization:
						this._runPostInitTasks();
						break;
					case NewProjectStartupPhase.Complete:
						this.postInitTasksComplete.open();
						break;
					default:
				}
				this._logService.debug(
					`[New project startup] Phase changed to ${phase}`
				);
			})
		);

		// Parse the new project configuration from the storage service
		this._newProjectConfig = this._parseNewProjectConfig();

		if (!this.isCurrentWindowNewProject()) {
			// If no new project configuration is found, the new project startup
			// is complete
			this.initTasksComplete.open();
		} else {
			// If new project configuration is found, save the runtime metadata.
			// This metadata will be overwritten if a new environment is created.
			this._runtimeMetadata = this._newProjectConfig?.runtimeMetadata;
		}

		// Initialize the pending tasks observable.
		// This initialization needs to take place after the new project configuration is parsed, so
		// that the tasks can be determined based on the configuration.
		this._pendingInitTasks = observableValue(
			'new-project-pending-tasks',
			this._getInitTasks()
		);
		this.onDidChangePendingInitTasks = Event.fromObservable(this._pendingInitTasks);
		this._register(
			this.onDidChangePendingInitTasks((tasks) => {
				this._logService.debug(
					`[New project startup] Pending tasks changed to: ${JSON.stringify(tasks)}`
				);
				// If there are no pending init tasks, it's time for runtime startup
				if (tasks.size === 0) {
					this._startupPhase.set(
						NewProjectStartupPhase.RuntimeStartup,
						undefined
					);
				}
			})
		);

		// Initialize the post initialization tasks observable.
		this._pendingPostInitTasks = observableValue(
			'new-project-post-init-tasks',
			this._getPostInitTasks()
		);
		this.onDidChangePostInitTasks = Event.fromObservable(this._pendingPostInitTasks);
		this._register(
			this.onDidChangePostInitTasks((tasks) => {
				this._logService.debug(
					`[New project startup] Post-init tasks changed to: ${JSON.stringify(tasks)}`
				);
				// If there are no post-init tasks, the new project startup is complete
				if (tasks.size === 0) {
					this._startupPhase.set(
						NewProjectStartupPhase.Complete,
						undefined
					);
				}
			}
			)
		);
	}

	//#region Private Methods

	/**
	 * Parses the new project configuration from the storage service and returns it.
	 * @returns The new project configuration.
	 */
	private _parseNewProjectConfig(): NewProjectConfiguration | null {
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
	 * Runs the tasks for the new project. This function assumes that we've already checked that the
	 * current window is the new project that was just created.
	 */
	private async _newProjectTasks() {
		this._startupPhase.set(
			NewProjectStartupPhase.CreatingProject,
			undefined
		);
		if (this._newProjectConfig) {
			await this._runExtensionTasks();
		} else {
			this._logService.error(
				'[New project startup] No new project configuration found'
			);
			this._notificationService.error(
				'Failed to create new project. No new project configuration found.'
			);
			this._startupPhase.set(NewProjectStartupPhase.Complete, undefined);
		}
	}

	//#region Extension Tasks

	/**
	 * Runs tasks that require the extension service to be ready.
	 */
	private async _runExtensionTasks() {
		// TODO: it would be nice to run these tasks in parallel!

		// First, create the new empty file since this is a quick task.
		if (this.pendingInitTasks.has(NewProjectTask.CreateNewFile)) {
			await this._runCreateNewFile();
		}

		// Next, run git init if needed.
		if (this.pendingInitTasks.has(NewProjectTask.Git)) {
			await this._runGitInit();
		}

		// Next, run language-specific tasks which may take a bit more time.
		if (this.pendingInitTasks.has(NewProjectTask.Python)) {
			await this._runPythonTasks();
		}
		if (this.pendingInitTasks.has(NewProjectTask.Jupyter)) {
			await this._runJupyterTasks();
		}
		if (this.pendingInitTasks.has(NewProjectTask.R)) {
			await this._runRTasks();
		}
	}

	/**
	 * Runs the appropriate command to create a new file based on the project type.
	 */
	private async _runCreateNewFile() {
		switch (this._newProjectConfig?.projectType) {
			case NewProjectType.PythonProject:
				await this._commandService.executeCommand('python.createNewFile');
				break;
			case NewProjectType.RProject:
				await this._commandService.executeCommand('r.createNewFile');
				break;
			case NewProjectType.JupyterNotebook:
				await this._commandService.executeCommand('ipynb.newUntitledIpynb');
				break;
			default:
				this._logService.error(
					'Cannot determine new file command for unknown project type',
					this._newProjectConfig?.projectType
				);
				break;
		}
		this._removePendingInitTask(NewProjectTask.CreateNewFile);
	}

	/**
	 * Runs Python Project specific tasks.
	 * Relies on extension ms-python.python
	 */
	private async _runPythonTasks() {
		// Create the Python environment
		if (this.pendingInitTasks.has(NewProjectTask.PythonEnvironment)) {
			await this._createPythonEnvironment();
		}

		// Complete the Python task
		this._removePendingInitTask(NewProjectTask.Python);
	}

	/**
	 * Runs Jupyter Notebook specific tasks.
	 * Relies on extension vscode.ipynb
	 */
	private async _runJupyterTasks() {
		// Create the Python environment
		// For now, Jupyter notebooks are always Python based. In the future, we'll need to surface
		// some UI in the Project Wizard for the user to select the language/kernel and pass that
		// metadata to the new project configuration.
		if (this.pendingInitTasks.has(NewProjectTask.PythonEnvironment)) {
			await this._createPythonEnvironment();
		}

		// Complete the Jupyter task
		this._removePendingInitTask(NewProjectTask.Jupyter);
	}

	/**
	 * Runs R Project specific tasks.
	 * Relies on extension positron.positron-r
	 */
	private async _runRTasks() {
		// no-op for now, since we haven't defined any pre-runtime startup R tasks
		// Complete the R task
		this._removePendingInitTask(NewProjectTask.R);
	}

	private async _runPostInitTasks() {
		if (this.pendingPostInitTasks.size === 0) {
			this._logService.debug('[New project startup] No post-init tasks to run.');
			this._startupPhase.set(NewProjectStartupPhase.Complete, undefined);
			return;
		}

		if (this.pendingPostInitTasks.has(NewProjectTask.REnvironment)) {
			await this._runRPostInitTasks();
		}
	}

	/**
	 * Runs R Project specific post-initialization tasks.
	 * Relies on extension positron.positron-r
	 */
	private async _runRPostInitTasks() {
		// Create the R environment
		if (this.pendingPostInitTasks.has(NewProjectTask.REnvironment)) {
			await this._createREnvironment();
		}
	}

	/**
	 * Displays an error notification if there was an error creating the .gitignore file.
	 * @param error The error that occurred.
	 */
	private _handleGitIgnoreError(error: Error) {
		const errorMessage = localize('positronNewProjectService.gitIgnoreError', 'Error creating .gitignore {0}', error.message);
		this._notificationService.error(errorMessage);
	}

	/**
	 * Runs the git init command.
	 * Relies on extension vscode.git
	 */
	private async _runGitInit() {
		if (!this._newProjectConfig) {
			this._logService.error(`[New project startup] git init - no new project configuration found`);
			return;
		}

		const projectRoot = URI.from({
			scheme: this._newProjectConfig.folderScheme,
			authority: this._newProjectConfig.folderAuthority,
			path: this._newProjectConfig.projectFolder
		});

		// true to skip the folder prompt
		await this._commandService.executeCommand('git.init', true)
			.catch((error) => {
				const errorMessage = localize('positronNewProjectService.gitInitError', 'Error initializing git repository {0}', error);
				this._notificationService.error(errorMessage);
			});
		await this._fileService.createFile(joinPath(projectRoot, 'README.md'), VSBuffer.fromString(`# ${this._newProjectConfig.projectName}`))
			.catch((error) => {
				const errorMessage = localize('positronNewProjectService.readmeError', 'Error creating readme {0}', error);
				this._notificationService.error(errorMessage);
			});

		switch (this._newProjectConfig.projectType) {
			case NewProjectType.PythonProject:
				await this._fileService.createFile(joinPath(projectRoot, '.gitignore'), VSBuffer.fromString(DOT_IGNORE_PYTHON))
					.catch((error) => {
						this._handleGitIgnoreError(error);
					});
				break;
			case NewProjectType.RProject:
				await this._fileService.createFile(joinPath(projectRoot, '.gitignore'), VSBuffer.fromString(DOT_IGNORE_R))
					.catch((error) => {
						this._handleGitIgnoreError(error);
					});
				break;
			case NewProjectType.JupyterNotebook:
				await this._fileService.createFile(joinPath(projectRoot, '.gitignore'), VSBuffer.fromString(DOT_IGNORE_JUPYTER))
					.catch((error) => {
						this._handleGitIgnoreError(error);
					});
				break;
			default:
				this._logService.error(
					'Cannot determine .gitignore content for unknown project type',
					this._newProjectConfig.projectType
				);
				break;
		}

		this._removePendingInitTask(NewProjectTask.Git);
	}

	/**
	 * Creates the Python environment.
	 * Relies on extension ms-python.python
	 */
	private async _createPythonEnvironment() {
		if (this._newProjectConfig) {
			const provider = this._newProjectConfig.pythonEnvProviderId;
			if (provider && provider.length > 0) {
				const runtimeMetadata = this._newProjectConfig.runtimeMetadata;
				const condaPythonVersion = this._newProjectConfig.condaPythonVersion;

				// Ensure the workspace folder is available
				const workspaceFolder =
					this._contextService.getWorkspace().folders[0];

				if (!workspaceFolder) {
					const message = this._failedPythonEnvMessage(
						`Could not determine workspace folder for ${this._newProjectConfig.projectFolder}.`
					);
					this._logService.error(message);
					this._notificationService.warn(message);
					this._removePendingInitTask(NewProjectTask.PythonEnvironment);
					return;
				}

				// Ensure the Python interpreter path is available. This is the global Python
				// interpreter to use for the new environment. This is only required if we are not
				// using a conda environment.
				const interpreterPath = runtimeMetadata?.extraRuntimeData?.pythonPath;
				if (!interpreterPath && !condaPythonVersion) {
					const message = this._failedPythonEnvMessage('Could not determine Python interpreter path for new project.');
					this._logService.error(message);
					this._notificationService.warn(message);
					this._removePendingInitTask(NewProjectTask.PythonEnvironment);
					return;
				}

				// Create the Python environment
				// Note: this command will show a quick pick to select the Python interpreter if the
				// specified Python interpreter is invalid for some reason (e.g. for Venv, if the
				// specified interpreter is not considered to be a Global Python installation).
				const createEnvCommand = 'python.createEnvironmentAndRegister';
				const result: CreateEnvironmentResult | undefined =
					await this._commandService.executeCommand(
						createEnvCommand,
						{
							workspaceFolder,
							providerId: provider,
							interpreterPath,
							condaPythonVersion,
							// Do not start the environment after creation. We'll install ipykernel
							// first, then set the environment as the affiliated runtime, which will
							// be automatically started by the runtimeStartupService.
							selectEnvironment: false
						}
					);

				// Check if the environment was created successfully
				if (!result || result.error || !result.path) {
					const errorDesc = (): string => {
						if (!result) {
							return 'No result returned from createEnvironment command.';
						}
						if (result.error) {
							return result.error.toString();
						}
						if (!result.path) {
							return 'No Python path returned from createEnvironment command.';
						}
						return 'unknown error.';
					};
					const message = this._failedPythonEnvMessage(errorDesc());
					this._logService.error(
						createEnvCommand +
						' with arguments: ' +
						JSON.stringify({
							workspaceFolder,
							providerId: provider,
							interpreterPath,
						}) +
						' failed. ' +
						message
					);
					this._notificationService.warn(message);
					this._removePendingInitTask(NewProjectTask.PythonEnvironment);
					return;
				}

				// Set the runtime metadata for the new project, whether it's undefined or not.
				this._runtimeMetadata = result.metadata;

				// Check if the newly created runtime metadata was returned
				if (!result.metadata) {
					// Warn the user, but don't exit early. We'll still try to continue since the
					// environment creation was successful.
					const message = this._failedPythonEnvMessage(`Could not determine interpreter metadata returned from ${createEnvCommand} command. The interpreter may need to be selected manually.`);
					this._logService.error(message);
					this._notificationService.warn(message);
				}

				this._removePendingInitTask(NewProjectTask.PythonEnvironment);

				return;
			}
		} else {
			// This shouldn't occur.
			const message = this._failedPythonEnvMessage('Could not determine runtime metadata for new project.');
			this._logService.error(message);
			this._notificationService.warn(message);
			this._removePendingInitTask(NewProjectTask.PythonEnvironment);
			return;
		}
	}

	/**
	 * Returns a localized message for a failed Python environment creation.
	 * @param reason The reason for the failure.
	 * @returns The localized message.
	 */
	private _failedPythonEnvMessage(reason: string): string {
		if (!this._newProjectConfig) {
			return '';
		}
		const {
			projectName,
			projectType,
			pythonEnvProviderName: providerName
		} = this._newProjectConfig;

		const message = localize(
			'positron.newProjectService.failedPythonEnvMessage',
			"Failed to create {0} environment for new {1} '{2}': {3}",
			providerName,
			projectType,
			projectName,
			reason
		);
		return message;
	}

	/**
	 * Creates the R environment.
	 * Relies on extension positron.positron-r
	 */
	private async _createREnvironment() {
		if (this._newProjectConfig?.useRenv) {
			await this._commandService.executeCommand('r.renvInit');
		}
		this._removePendingPostInitTask(NewProjectTask.REnvironment);
	}

	//#endregion Extension Tasks

	/**
	 * Removes a pending init task.
	 */
	private _removePendingInitTask(task: NewProjectTask) {
		const updatedPendingTasks = new Set(this.pendingInitTasks);
		updatedPendingTasks.delete(task);
		this._pendingInitTasks.set(updatedPendingTasks, undefined);
	}

	/**
	 * Removes a pending post-init task.
	 */
	private _removePendingPostInitTask(task: NewProjectTask) {
		const updatedPendingTasks = new Set(this.pendingPostInitTasks);
		updatedPendingTasks.delete(task);
		this._pendingPostInitTasks.set(updatedPendingTasks, undefined);
	}

	/**
	 * Returns the tasks that need to be performed for the new project.
	 */
	private _getInitTasks(): Set<NewProjectTask> {
		if (!this._newProjectConfig) {
			return new Set();
		}

		const tasks = new Set<NewProjectTask>();
		switch (this._newProjectConfig.projectType) {
			case NewProjectType.PythonProject:
				tasks.add(NewProjectTask.Python);
				if (this._newProjectConfig.pythonEnvProviderId) {
					tasks.add(NewProjectTask.PythonEnvironment);
				}
				break;
			case NewProjectType.JupyterNotebook:
				tasks.add(NewProjectTask.Jupyter);
				// For now, Jupyter notebooks are always Python based.
				if (this._newProjectConfig.pythonEnvProviderId) {
					tasks.add(NewProjectTask.PythonEnvironment);
				}
				break;
			case NewProjectType.RProject:
				tasks.add(NewProjectTask.R);
				break;
			default:
				this._logService.error(
					'Cannot determine new project tasks for unknown project type',
					this._newProjectConfig.projectType
				);
				return new Set();
		}

		if (this._newProjectConfig.initGitRepo) {
			tasks.add(NewProjectTask.Git);
		}

		// Always create a new file in the new project. This may be controlled by a project config
		// setting in the future.
		tasks.add(NewProjectTask.CreateNewFile);

		return tasks;
	}

	/**
	 * Returns the post initialization tasks that need to be performed for the new project.
	 * @returns Returns the post initialization tasks that need to be performed for the new project.
	 */
	private _getPostInitTasks(): Set<NewProjectTask> {
		if (!this._newProjectConfig) {
			return new Set();
		}

		// listen for runtime to be created so that post-init tasks can be run
		const sessionListener = this._runtimeSessionService.onDidStartRuntime(async (runtimeId) => {
			this._logService.debug('[New project startup] Runtime created. Running post-init tasks.');
			this._startupPhase.set(NewProjectStartupPhase.PostInitialization, undefined);
			sessionListener.dispose();
		});

		const tasks = new Set<NewProjectTask>();
		if (this._newProjectConfig.useRenv) {
			tasks.add(NewProjectTask.REnvironment);
		}

		return tasks;
	}

	//#endregion Private Methods

	//#region Public Methods

	isCurrentWindowNewProject() {
		// There is no new project configuration, so a new project was not created.
		if (!this._newProjectConfig) {
			return false;
		}
		const currentFolderPath =
			this._contextService.getWorkspace().folders[0]?.uri;
		const newProjectFolder = URI.from({
			scheme: this._newProjectConfig.folderScheme,
			authority: this._newProjectConfig.folderAuthority,
			path: this._newProjectConfig.projectFolder
		});
		const currentWindowIsNewProject = relativePath(currentFolderPath, newProjectFolder) === '';
		this._logService.debug(`[New project startup] Current window is new project: ${currentWindowIsNewProject}`);
		return currentWindowIsNewProject;
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
				this._newProjectTasks();
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
								this._newProjectTasks();
							}
						}
					)
				);
			}
		} else {
			this._logService.error(
				'[New project startup] No new project configuration found'
			);
			this._notificationService.error(
				'Failed to create new project. No new project configuration found.'
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

	//#endregion Public Methods

	//#region Getters and Setters

	/**
	 * Returns the current startup phase.
	 */
	get startupPhase(): NewProjectStartupPhase {
		return this._startupPhase.get();
	}

	/**
	 * Returns the pending tasks.
	 */
	get pendingInitTasks(): Set<string> {
		return this._pendingInitTasks.get();
	}

	/**
	 * Returns the pending post-init tasks.
	 */
	get pendingPostInitTasks(): Set<string> {
		return this._pendingPostInitTasks.get();
	}

	/**
	 * Returns the runtime metadata for the new project.
	 */
	public get newProjectRuntimeMetadata(): ILanguageRuntimeMetadata | undefined {
		return this._runtimeMetadata;
	}

	//#endregion Getters and Setters
}
