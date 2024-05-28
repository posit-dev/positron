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
import { CreateEnvironmentResult, IPositronNewProjectService, NewProjectConfiguration, NewProjectStartupPhase, NewProjectTask, POSITRON_NEW_PROJECT_CONFIG_STORAGE_KEY } from 'vs/workbench/services/positronNewProject/common/positronNewProject';
import { Event } from 'vs/base/common/event';
import { Barrier } from 'vs/base/common/async';
import { ILanguageRuntimeMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IFileService } from 'vs/platform/files/common/files';
import { VSBuffer } from 'vs/base/common/buffer';
import { joinPath } from 'vs/base/common/resources';
import { DOT_IGNORE_JUPYTER, DOT_IGNORE_PYTHON, DOT_IGNORE_R } from 'vs/workbench/services/positronNewProject/common/positronNewProjectTemplates';
import { URI } from 'vs/base/common/uri';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { localize } from 'vs/nls';

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
	private readonly _runtimeMetadata: ILanguageRuntimeMetadata | undefined;

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

		if (!this._isCurrentWindowNewProject()) {
			// If no new project configuration is found, the new project startup
			// is complete
			this.allTasksComplete.open();
		} else {
			// If new project configuration is found, save the runtime metadata
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
					`[New project startup] Pending tasks changed to ${tasks}`
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

	/**
	 * Returns the runtime metadata for the new project.
	 */
	public get newProjectRuntimeMetadata(): ILanguageRuntimeMetadata | undefined {
		return this._runtimeMetadata;
	}

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
	 * Determines whether the current window the new project that was just created.
	 * @returns Whether the current window is the newly created project.
	 */
	private _isCurrentWindowNewProject() {
		// There is no new project configuration, so a new project was not created.
		if (!this._newProjectConfig) {
			return false;
		}
		const newProjectPath = this._newProjectConfig.projectFolder;
		const currentFolderPath =
			this._contextService.getWorkspace().folders[0]?.uri.fsPath;
		return newProjectPath === currentFolderPath;
	}

	/**
	 * Runs tasks that require the extension service to be ready.
	 */
	private async _runExtensionTasks() {
		if (this.pendingTasks.has(NewProjectTask.Python)) {
			await this._runPythonTasks();
		}

		if (this.pendingTasks.has(NewProjectTask.Jupyter)) {
			await this._runJupyterTasks();
		}

		if (this.pendingTasks.has(NewProjectTask.R)) {
			await this._runRTasks();
		}

		if (this.pendingTasks.has(NewProjectTask.Git)) {
			await this._runGitInit();
		}
	}

	/**
	 * Runs Python Project specific tasks.
	 * Relies on extension ms-python.python
	 */
	private async _runPythonTasks() {
		if (this.pendingTasks.has(NewProjectTask.PythonEnvironment)) {
			await this._createPythonEnvironment();
		}

		await this._commandService.executeCommand('python.createNewFile');
		this._removePendingTask(NewProjectTask.Python);
	}

	/**
	 * Runs Jupyter Notebook specific tasks.
	 * Relies on extension vscode.ipynb
	 */
	private async _runJupyterTasks() {
		// For now, Jupyter notebooks are always Python based. In the future, we'll need to surface
		// some UI in the Project Wizard for the user to select the language/kernel and pass that
		// metadata to the new project configuration.
		if (this.pendingTasks.has(NewProjectTask.PythonEnvironment)) {
			await this._createPythonEnvironment();
		}

		await this._commandService.executeCommand('ipynb.newUntitledIpynb');
		this._removePendingTask(NewProjectTask.Jupyter);
	}

	/**
	 * Runs R Project specific tasks.
	 * Relies on extension vscode.positron-r
	 */
	private async _runRTasks() {
		if (this.pendingTasks.has(NewProjectTask.REnvironment)) {
			await this._createREnvironment();
		}

		await this._commandService.executeCommand('r.createNewFile');
		this._removePendingTask(NewProjectTask.R);
	}

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
		const gitInitTask = new Promise(() => {
			// true to skip the folder prompt
			this._commandService.executeCommand('git.init', true)
				.catch((error) => {
					const errorMessage = localize('positronNewProjectService.gitInitError', 'Error initializing git repository {0}', error);
					this._notificationService.error(errorMessage);
				});
		});
		const readmeTask = new Promise(() => {
			this._fileService.createFile(joinPath(projectRoot, 'README.md'), VSBuffer.fromString(`# ${this._newProjectConfig?.projectName}`))
				.catch((error) => {
					this._handleGitIgnoreError(error);
				});
		});
		const tasks = [gitInitTask, readmeTask];

		// TODO: use enum values instead of strings
		switch (this._newProjectConfig?.projectType) {
			case 'Python Project':
				tasks.push(new Promise(() => {
					this._fileService.createFile(joinPath(projectRoot, '.gitignore'), VSBuffer.fromString(DOT_IGNORE_PYTHON))
						.catch((error) => {
							this._handleGitIgnoreError(error);
						});
				}));
				break;
			case 'R Project':
				tasks.push(new Promise(() => {
					this._fileService.createFile(joinPath(projectRoot, '.gitignore'), VSBuffer.fromString(DOT_IGNORE_R))
						.catch((error) => {
							this._handleGitIgnoreError(error);
						});
				}));
				break;
			case 'Jupyter Notebook':
				tasks.push(new Promise(() => {
					this._fileService.createFile(joinPath(projectRoot, '.gitignore'), VSBuffer.fromString(DOT_IGNORE_JUPYTER))
						.catch((error) => {
							this._handleGitIgnoreError(error);
						});
				}));
				break;
			default:
		}

		await Promise.allSettled(tasks);

		this._removePendingTask(NewProjectTask.Git);
	}

	/**
	 * Creates the Python environment.
	 * Relies on extension ms-python.python
	 */
	private async _createPythonEnvironment() {
		const pythonEnvProvider = this._newProjectConfig?.pythonEnvProviderId;
		if (pythonEnvProvider && pythonEnvProvider.length > 0) {
			const workspaceFolder =
				this._contextService.getWorkspace().folders[0];
			if (!workspaceFolder) {
				this._logService.error(
					'Could not determine workspace folder for new project. Cannot create Python environment.'
				);
				return;
			}
			const interpreterPath =
				this._newProjectConfig?.runtimeMetadata?.extraRuntimeData
					?.pythonPath;
			if (!interpreterPath) {
				this._logService.warn(
					'Could not determine Python interpreter path for new project.'
				);
				return;
			}
			// Note: this command will show a quick pick to select the Python interpreter if the
			// specified Python interpreter is invalid for some reason (e.g. for Venv, if the
			// specified interpreter is not considered to be a Global Python installation).
			const result: CreateEnvironmentResult | undefined =
				await this._commandService.executeCommand(
					'python.createEnvironment',
					{
						workspaceFolder,
						providerId: pythonEnvProvider,
						interpreterPath,
					}
				);

			// Check if the environment was created successfully
			if (!result || result.error) {
				const error = result?.error ?? 'Unknown error';
				this._logService.error(
					`Error while creating Python environment for new project: ${error}`
				);
				return;
			}

			// Install ipykernel in the new environment
			const pythonPath = result.path;
			await this._commandService.executeCommand(
				'python.installIpykernel',
				String(pythonPath)
			);

			// TODO: Start the affiliated runtime.
			// runtimeSessionService.selectRuntime -- needs a runtimeId
			// leverage validateMetadata to pass a pythonPath to the python extension and have the
			// extension resolve it into an actual runtime metadata object
			//   - see src/positron-dts/positron.d.ts validateMetadata
		}
		this._removePendingTask(NewProjectTask.PythonEnvironment);
	}

	/**
	 * Creates the R environment.
	 * Relies on extension vscode.positron-r
	 */
	private async _createREnvironment() {
		// TODO: run renv::init()
		this._removePendingTask(NewProjectTask.REnvironment);
	}

	async initNewProject() {
		if (!this._isCurrentWindowNewProject()) {
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
			this._startupPhase.set(NewProjectStartupPhase.Complete, undefined);
		}
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
		// TODO: use enum values instead of strings
		switch (this._newProjectConfig.projectType) {
			case 'Python Project':
				tasks.add(NewProjectTask.Python);
				break;
			case 'Jupyter Notebook':
				tasks.add(NewProjectTask.Jupyter);
				break;
			case 'R Project':
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

		if (this._newProjectConfig.pythonEnvProviderId) {
			tasks.add(NewProjectTask.PythonEnvironment);
		}

		if (this._newProjectConfig.useRenv) {
			tasks.add(NewProjectTask.REnvironment);
		}

		return tasks;
	}
}
