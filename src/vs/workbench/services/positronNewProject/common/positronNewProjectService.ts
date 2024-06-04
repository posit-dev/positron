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
import { CreateEnvironmentResult, IPositronNewProjectService, LanguageIds, NewProjectConfiguration, NewProjectStartupPhase, NewProjectTask, NewProjectType, POSITRON_NEW_PROJECT_CONFIG_STORAGE_KEY } from 'vs/workbench/services/positronNewProject/common/positronNewProject';
import { Event } from 'vs/base/common/event';
import { Barrier } from 'vs/base/common/async';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionLocation, LanguageRuntimeStartupBehavior } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IFileService } from 'vs/platform/files/common/files';
import { VSBuffer } from 'vs/base/common/buffer';
import { joinPath } from 'vs/base/common/resources';
import { DOT_IGNORE_JUPYTER, DOT_IGNORE_PYTHON, DOT_IGNORE_R } from 'vs/workbench/services/positronNewProject/common/positronNewProjectTemplates';
import { URI } from 'vs/base/common/uri';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { localize } from 'vs/nls';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';

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

	// Barrier to signal that all tasks are complete
	public allTasksComplete: Barrier = new Barrier();

	// Runtime metadata for the new project
	private _runtimeMetadata: ILanguageRuntimeMetadata | undefined;

	// Create the Positron New Project service instance.
	constructor(
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@ICommandService private readonly _commandService: ICommandService,
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
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
			this.onDidChangeNewProjectStartupPhase((phase) => {
				// Open barrier when all tasks are complete
				if (phase === NewProjectStartupPhase.Complete) {
					this.allTasksComplete.open();
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
			this.allTasksComplete.open();
		} else {
			// If new project configuration is found, save the runtime metadata.
			// This metadata will be overwritten if a new environment is created.
			this._runtimeMetadata = this._newProjectConfig?.runtimeMetadata;
		}

		// Initialize the pending tasks observable.
		// This initialization needs to take place after the new project configuration is parsed, so
		// that the tasks can be determined based on the configuration.
		this._pendingTasks = observableValue(
			'new-project-pending-tasks',
			this._getTasks()
		);
		this.onDidChangePendingTasks = Event.fromObservable(this._pendingTasks);
		this._register(
			this.onDidChangePendingTasks((tasks) => {
				this._logService.debug(
					`[New project startup] Pending tasks changed to: ${tasks}`
				);
				// If there are no pending tasks, the new project startup is complete
				if (tasks.size === 0) {
					this._startupPhase.set(
						NewProjectStartupPhase.Complete,
						undefined
					);
				}
			})
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
		if (this.pendingTasks.has(NewProjectTask.CreateNewFile)) {
			await this._runCreateNewFile();
		}

		// Next, run git init if needed.
		if (this.pendingTasks.has(NewProjectTask.Git)) {
			await this._runGitInit();
		}

		// Next, run language-specific tasks which may take a bit more time.
		if (this.pendingTasks.has(NewProjectTask.Python)) {
			await this._runPythonTasks();
		}
		if (this.pendingTasks.has(NewProjectTask.Jupyter)) {
			await this._runJupyterTasks();
		}
		if (this.pendingTasks.has(NewProjectTask.R)) {
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
		this._removePendingTask(NewProjectTask.CreateNewFile);
	}

	/**
	 * Runs Python Project specific tasks.
	 * Relies on extension ms-python.python
	 */
	private async _runPythonTasks() {
		// Create the Python environment
		if (this.pendingTasks.has(NewProjectTask.PythonEnvironment)) {
			await this._createPythonEnvironment();
		}

		// Complete the Python task
		this._removePendingTask(NewProjectTask.Python);
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
		if (this.pendingTasks.has(NewProjectTask.PythonEnvironment)) {
			await this._createPythonEnvironment();
		}

		// Complete the Jupyter task
		this._removePendingTask(NewProjectTask.Jupyter);
	}

	/**
	 * Runs R Project specific tasks.
	 * Relies on extension vscode.positron-r
	 */
	private async _runRTasks() {
		// Create the R environment
		if (this.pendingTasks.has(NewProjectTask.REnvironment)) {
			await this._createREnvironment();
		}

		// Complete the R task
		this._removePendingTask(NewProjectTask.R);
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
		const projectRoot = URI.file(this._newProjectConfig?.projectFolder!);

		// true to skip the folder prompt
		await this._commandService.executeCommand('git.init', true)
			.catch((error) => {
				const errorMessage = localize('positronNewProjectService.gitInitError', 'Error initializing git repository {0}', error);
				this._notificationService.error(errorMessage);
			});
		await this._fileService.createFile(joinPath(projectRoot, 'README.md'), VSBuffer.fromString(`# ${this._newProjectConfig?.projectName}`))
			.catch((error) => {
				const errorMessage = localize('positronNewProjectService.readmeError', 'Error creating readme {0}', error);
				this._notificationService.error(errorMessage);
			});

		switch (this._newProjectConfig?.projectType) {
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
					this._newProjectConfig?.projectType
				);
				break;
		}

		this._removePendingTask(NewProjectTask.Git);
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
					const message = this._failedPythonEnvMessage(`Could not determine workspace folder for ${this._newProjectConfig.projectFolder}.`);
					this._logService.error(message);
					this._notificationService.warn(message);
					this._removePendingTask(NewProjectTask.PythonEnvironment);
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
					this._removePendingTask(NewProjectTask.PythonEnvironment);
					return;
				}

				// Create the Python environment
				// Note: this command will show a quick pick to select the Python interpreter if the
				// specified Python interpreter is invalid for some reason (e.g. for Venv, if the
				// specified interpreter is not considered to be a Global Python installation).
				const createEnvCommand = 'python.createEnvironment';
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
					this._removePendingTask(NewProjectTask.PythonEnvironment);
					return;
				}

				// Install ipykernel in the new environment
				await this._commandService.executeCommand(
					'python.installIpykernel',
					String(result.path)
				);

				// Construct a skeleton runtime metadata object which will be validated by the Python
				// extension using validateMetadata into a full runtime metadata object.
				// Minimally, we'll need to provide the languageId for runtimeStartupService, the
				// Python extension ID so a runtime manager can be determined and the pythonPath is
				// used by the Python extension to look up the registered runtime.
				this._runtimeMetadata = {
					runtimePath: result.path,
					runtimeId: '',
					languageName: '',
					languageId: LanguageIds.Python,
					languageVersion: '',
					base64EncodedIconSvg: '',
					runtimeName: '',
					runtimeShortName: '',
					runtimeVersion: '',
					runtimeSource: '',
					startupBehavior: LanguageRuntimeStartupBehavior.Immediate,
					sessionLocation: LanguageRuntimeSessionLocation.Workspace,
					// ExtensionIdentifier is not supposed to be constructed directly, but we are
					// leveraging the 'ms-python.python' extension to fill in the actual metadata for
					// the newly created environment.
					extensionId: new ExtensionIdentifier('ms-python.python'),
					extraRuntimeData: {
						pythonPath: result.path,
					},
				} satisfies ILanguageRuntimeMetadata;

				this._removePendingTask(NewProjectTask.PythonEnvironment);
				return;
			}
		} else {
			// This shouldn't occur.
			const message = this._failedPythonEnvMessage('Could not determine runtime metadata for new project.');
			this._logService.error(message);
			this._notificationService.warn(message);
			this._removePendingTask(NewProjectTask.PythonEnvironment);
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
	 * Relies on extension vscode.positron-r
	 */
	private async _createREnvironment() {
		// TODO: run renv::init()
		this._removePendingTask(NewProjectTask.REnvironment);
	}

	//#endregion Extension Tasks

	/**
	 * Removes a pending task.
	 */
	private _removePendingTask(task: NewProjectTask) {
		const updatedPendingTasks = new Set(this.pendingTasks);
		updatedPendingTasks.delete(task);
		this._pendingTasks.set(updatedPendingTasks, undefined);
	}

	/**
	 * Returns the tasks that need to be performed for the new project.
	 */
	private _getTasks(): Set<NewProjectTask> {
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
				if (this._newProjectConfig.useRenv) {
					tasks.add(NewProjectTask.REnvironment);
				}
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

	//#endregion Private Methods

	//#region Public Methods

	isCurrentWindowNewProject() {
		// There is no new project configuration, so a new project was not created.
		if (!this._newProjectConfig) {
			return false;
		}
		const newProjectPath = this._newProjectConfig.projectFolder;
		const currentFolderPath =
			this._contextService.getWorkspace().folders[0]?.uri.fsPath;
		return newProjectPath === currentFolderPath;
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
	get pendingTasks(): Set<string> {
		return this._pendingTasks.get();
	}

	/**
	 * Returns the runtime metadata for the new project.
	 */
	public get newProjectRuntimeMetadata(): ILanguageRuntimeMetadata | undefined {
		return this._runtimeMetadata;
	}

	//#endregion Getters and Setters
}
