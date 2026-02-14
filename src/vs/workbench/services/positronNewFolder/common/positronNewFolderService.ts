/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { ISettableObservable, observableValue } from '../../../../base/common/observable.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { CreateEnvironmentResult, CreatePyprojectTomlResult, IPositronNewFolderService, NewFolderConfiguration, NewFolderStartupPhase, NewFolderTask, FolderTemplate, POSITRON_NEW_FOLDER_CONFIG_STORAGE_KEY } from './positronNewFolder.js';
import { Event } from '../../../../base/common/event.js';
import { Barrier } from '../../../../base/common/async.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode } from '../../languageRuntime/common/languageRuntimeService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath, relativePath } from '../../../../base/common/resources.js';
import { DOT_IGNORE_JUPYTER, DOT_IGNORE_PYTHON, DOT_IGNORE_R } from './positronNewFolderTemplates.js';
import { URI } from '../../../../base/common/uri.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { localize } from '../../../../nls.js';
import { IRuntimeSessionService, RuntimeStartMode } from '../../runtimeSession/common/runtimeSessionService.js';
import { INotebookEditorService } from '../../../contrib/notebook/browser/services/notebookEditorService.js';
import { INotebookKernel, INotebookKernelService } from '../../../contrib/notebook/common/notebookKernelService.js';
import { INotebookTextModel } from '../../../contrib/notebook/common/notebookCommon.js';

/**
 * PositronNewFolderService class.
 */
export class PositronNewFolderService extends Disposable implements IPositronNewFolderService {
	declare readonly _serviceBrand: undefined;

	// New folder configuration
	private _newFolderConfig: NewFolderConfiguration | null;

	// New folder startup phase tracking
	private _startupPhase: ISettableObservable<NewFolderStartupPhase>;
	onDidChangeNewFolderStartupPhase: Event<NewFolderStartupPhase>;

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

	// Runtime metadata for the new folder
	private _runtimeMetadata: ILanguageRuntimeMetadata | undefined;

	// Add a single log prefix for notebook-startup related messages
	private readonly _nbLogPrefix = '[New folder notebook]';

	// Create the Positron New Folder service instance.
	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
		@INotebookEditorService private readonly _notebookEditorService: INotebookEditorService,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService,
	) {
		super();

		// Initialize the new folder startup phase observable
		this._startupPhase = observableValue(
			'new-folder-startup-phase',
			NewFolderStartupPhase.Initializing
		);
		this.onDidChangeNewFolderStartupPhase = Event.fromObservable(
			this._startupPhase
		);
		this._register(
			this.onDidChangeNewFolderStartupPhase((phase) => {
				switch (phase) {
					case NewFolderStartupPhase.RuntimeStartup:
						this.initTasksComplete.open();
						break;
					case NewFolderStartupPhase.PostInitialization:
						this._runPostInitTasks();
						break;
					case NewFolderStartupPhase.Complete:
						// Open both the init and post-init task barriers because some new folders
						// do not have a runtime startup phase (e.g. Empty Project).
						this.initTasksComplete.open();
						this.postInitTasksComplete.open();
						break;
					default:
				}
				this._logService.debug(
					`[New folder startup] Phase changed to ${phase}`
				);
			})
		);

		// Parse the new folder configuration from the storage service
		this._newFolderConfig = this._parseNewFolderConfig();

		if (!this.isCurrentWindowNewFolder()) {
			// This window is not the new folder window, so initialization is
			// already complete.
			this.initTasksComplete.open();
		} else {
			// If new folder configuration is found, save the runtime metadata.
			// This metadata will be overwritten if a new environment is created.
			this._runtimeMetadata = this._newFolderConfig?.runtimeMetadata;
		}

		// Initialize the pending tasks observable.
		// This initialization needs to take place after the new folder configuration is parsed, so
		// that the tasks can be determined based on the configuration.
		this._pendingInitTasks = observableValue(
			'new-folder-pending-tasks',
			this._getInitTasks()
		);
		this.onDidChangePendingInitTasks = Event.fromObservable(this._pendingInitTasks);
		this._register(
			this.onDidChangePendingInitTasks((tasks) => {
				this._logService.debug(
					`[New folder startup] Pending tasks changed to: ${JSON.stringify(tasks)}`
				);
				// If there are no pending init tasks, it's time for runtime startup
				if (tasks.size === 0) {
					this._startupPhase.set(
						NewFolderStartupPhase.RuntimeStartup,
						undefined
					);
				}
			})
		);

		// Initialize the post initialization tasks observable.
		this._pendingPostInitTasks = observableValue(
			'new-folder-post-init-tasks',
			this._getPostInitTasks()
		);
		this.onDidChangePostInitTasks = Event.fromObservable(this._pendingPostInitTasks);
		this._register(
			this.onDidChangePostInitTasks((tasks) => {
				this._logService.debug(
					`[New folder startup] Post-init tasks changed to: ${JSON.stringify(tasks)}`
				);
				// If there are no post-init tasks, the new folder startup is complete
				if (tasks.size === 0) {
					this._startupPhase.set(
						NewFolderStartupPhase.Complete,
						undefined
					);
				}
			}
			)
		);
	}

	//#region Private Methods

	/**
	 * Applies the appropriate layout for the folder template.
	 * This is called before awaiting trust since layout changes don't require trust.
	 */
	private async _applyLayout(): Promise<void> {
		if (!this._newFolderConfig) {
			return;
		}

		// Apply notebook layout if this is a Jupyter Notebook template opened in a new window.
		// When opened in the current window, we preserve the user's existing layout.
		if (this._newFolderConfig.folderTemplate === FolderTemplate.JupyterNotebook &&
			this._newFolderConfig.openInNewWindow) {
			this._logService.debug('[New folder startup] Applying notebook layout for Jupyter Notebook folder template in new window');
			await this._commandService.executeCommand('workbench.action.positronNotebookLayout');
		}
	}

	/**
	 * Parses the new folder configuration from the storage service and returns it.
	 * @returns The new folder configuration.
	 */
	private _parseNewFolderConfig(): NewFolderConfiguration | null {
		const newFolderConfigStr = this._storageService.get(
			POSITRON_NEW_FOLDER_CONFIG_STORAGE_KEY,
			StorageScope.APPLICATION
		);
		if (!newFolderConfigStr) {
			this._logService.debug(
				'No new folder configuration found in storage'
			);
			return null;
		}
		return JSON.parse(newFolderConfigStr) as NewFolderConfiguration;
	}

	/**
	 * Runs the tasks for the new folder. This function assumes that we've already checked that the
	 * current window is the new folder that was just created.
	 */
	private async _newFolderTasks() {
		this._startupPhase.set(
			NewFolderStartupPhase.CreatingFolder,
			undefined
		);
		if (this._newFolderConfig) {
			await this._runExtensionTasks();

			// For folders that do not require a runtime startup phase, we set the startup phase to Complete.
			if (this._newFolderConfig.folderTemplate === FolderTemplate.EmptyProject ||
				this._newFolderConfig.folderTemplate === FolderTemplate.JupyterNotebook
			) {
				this._startupPhase.set(NewFolderStartupPhase.Complete, undefined);
			}

		} else {
			this._logService.error(
				'[New folder startup] No new folder configuration found'
			);
			this._notificationService.error(
				'Failed to create new folder. No new folder configuration found.'
			);
			this._startupPhase.set(NewFolderStartupPhase.Complete, undefined);
		}
	}

	//#region Extension Tasks

	/**
	 * Runs tasks that require the extension service to be ready.
	 */
	private async _runExtensionTasks() {
		// Map of language NewFolderTask to the FolderTemplate it supports.
		// Used to determine whether file creation should be skipped when a
		// language environment task fails. Git is intentionally absent -
		// a Git init failure should not prevent file creation.
		const languageTaskToTemplate = new Map<NewFolderTask, FolderTemplate>([
			[NewFolderTask.Python, FolderTemplate.PythonProject],
			[NewFolderTask.Jupyter, FolderTemplate.JupyterNotebook],
			[NewFolderTask.R, FolderTemplate.RProject],
		]);

		// Collect environment tasks to run in parallel. We store the
		// task enum value and a factory function so that all promises
		// are created together at the `Promise.allSettled` call site.
		const environmentTasks: { task: NewFolderTask; run: () => Promise<void> }[] = [];
		if (this.pendingInitTasks.has(NewFolderTask.Git)) {
			environmentTasks.push({ task: NewFolderTask.Git, run: () => this._runGitInit() });
		}
		if (this.pendingInitTasks.has(NewFolderTask.Python)) {
			environmentTasks.push({ task: NewFolderTask.Python, run: () => this._runPythonTasks() });
		}
		if (this.pendingInitTasks.has(NewFolderTask.Jupyter)) {
			environmentTasks.push({ task: NewFolderTask.Jupyter, run: () => this._runJupyterTasks() });
		}
		if (this.pendingInitTasks.has(NewFolderTask.R)) {
			environmentTasks.push({ task: NewFolderTask.R, run: () => this._runRTasks() });
		}

		const results = await Promise.allSettled(environmentTasks.map(t => t.run()));
		const failedTasks = new Set<NewFolderTask>();
		for (let i = 0; i < results.length; i++) {
			if (results[i].status === 'rejected') {
				const { task } = environmentTasks[i];
				failedTasks.add(task);
				this._logService.error(`[New folder startup] ${task} task failed:`, (results[i] as PromiseRejectedResult).reason);
				this._removePendingInitTask(task);
			}
		}

		// Create the new file last because opening a language file triggers a
		// language encounter; doing it after the environment tasks ensures the
		// correct interpreter is affiliated. Skip file creation if the
		// relevant language task failed, since the interpreter won't be set up.
		if (this.pendingInitTasks.has(NewFolderTask.CreateNewFile)) {
			const template = this._newFolderConfig?.folderTemplate;
			const languageTaskFailed = [...failedTasks].some(
				task => languageTaskToTemplate.get(task) === template
			);
			if (languageTaskFailed) {
				this._logService.warn('[New folder startup] Skipping file creation because the language environment task failed');
				this._removePendingInitTask(NewFolderTask.CreateNewFile);
			} else {
				await this._runCreateNewFile();
			}
		}
	}

	/**
	 * Runs the appropriate command to create a new file based on the folder template.
	 */
	private async _runCreateNewFile() {
		switch (this._newFolderConfig?.folderTemplate) {
			case FolderTemplate.PythonProject:
				await this._commandService.executeCommand('python.createNewFile');
				break;
			case FolderTemplate.RProject:
				await this._commandService.executeCommand('r.createNewFile');
				break;
			case FolderTemplate.JupyterNotebook: {
				// Use the languageId from the runtime metadata if available, otherwise use 'python' as a default because that's the most common language for Jupyter Notebooks.
				const languageId = this._newFolderConfig?.runtimeMetadata?.languageId ?? 'python';
				await this._commandService.executeCommand('ipynb.newUntitledIpynb', languageId);
				break;
			}
			default:
				this._logService.error(
					'Cannot determine new file command for unknown folder template',
					this._newFolderConfig?.folderTemplate
				);
				break;
		}
		this._removePendingInitTask(NewFolderTask.CreateNewFile);
	}

	/**
	 * Runs Python specific tasks.
	 * Relies on extension ms-python.python
	 */
	private async _runPythonTasks() {
		// Create the Python environment
		if (this.pendingInitTasks.has(NewFolderTask.PythonEnvironment)) {
			const success = await this._createPythonEnvironment();
			if (!success) {
				this._removePendingInitTask(NewFolderTask.Python);
				throw new Error('Python environment creation failed');
			}
		}

		// Add pyproject.toml file if requested
		if (this.pendingInitTasks.has(NewFolderTask.CreatePyprojectToml)) {
			await this._createPyprojectToml();
		}

		// Complete the Python task
		this._removePendingInitTask(NewFolderTask.Python);
	}

	/**
	 * Runs Jupyter Notebook specific tasks.
	 * Relies on extension vscode.ipynb
	 */
	private async _runJupyterTasks() {
		// Create the Python environment
		// For now, Jupyter notebooks are always Python based. In the future, we'll need to surface
		// some UI in the New Folder Flow for the user to select the language/kernel and pass that
		// metadata to the new folder configuration.
		if (this.pendingInitTasks.has(NewFolderTask.PythonEnvironment)) {
			const success = await this._createPythonEnvironment();
			if (!success) {
				this._removePendingInitTask(NewFolderTask.Jupyter);
				throw new Error('Jupyter environment creation failed');
			}
		}

		// Complete the Jupyter task
		this._removePendingInitTask(NewFolderTask.Jupyter);
	}

	/**
	 * Runs R specific tasks.
	 * Relies on extension positron.positron-r
	 */
	private async _runRTasks() {
		// no-op for now, since we haven't defined any pre-runtime startup R tasks
		// Complete the R task
		this._removePendingInitTask(NewFolderTask.R);
	}

	private async _runPostInitTasks() {
		if (this.pendingPostInitTasks.size === 0) {
			this._logService.debug('[New folder startup] No post-init tasks to run.');
			this._startupPhase.set(NewFolderStartupPhase.Complete, undefined);
			return;
		}

		if (this.pendingPostInitTasks.has(NewFolderTask.REnvironment)) {
			await this._runRPostInitTasks();
		}
	}

	/**
	 * Runs R specific post-initialization tasks.
	 * Relies on extension positron.positron-r
	 */
	private async _runRPostInitTasks() {
		// Create the R environment
		if (this.pendingPostInitTasks.has(NewFolderTask.REnvironment)) {
			await this._createREnvironment();
		}
	}

	/**
	 * Displays an error notification if there was an error creating the .gitignore file.
	 * @param error The error that occurred.
	 */
	private _handleGitIgnoreError(error: Error) {
		const errorMessage = localize('positronNewFolderService.gitIgnoreError', 'Error creating .gitignore {0}', error.message);
		this._notificationService.error(errorMessage);
	}

	/**
	 * Runs the git init command.
	 * Relies on extension vscode.git
	 */
	private async _runGitInit() {
		if (!this._newFolderConfig) {
			this._logService.error(`[New folder startup] git init - no new folder configuration found`);
			return;
		}

		const folderRoot = URI.from({
			scheme: this._newFolderConfig.folderScheme,
			authority: this._newFolderConfig.folderAuthority,
			path: this._newFolderConfig.folderPath
		});

		// true to skip the folder prompt
		await this._commandService.executeCommand('git.init', true)
			.catch((error) => {
				const errorMessage = localize('positronNewFolderService.gitInitError', 'Error initializing git repository {0}', error);
				this._notificationService.error(errorMessage);
			});
		await this._fileService.createFile(joinPath(folderRoot, 'README.md'), VSBuffer.fromString(`# ${this._newFolderConfig.folderName}`))
			.catch((error) => {
				const errorMessage = localize('positronNewFolderService.readmeError', 'Error creating readme {0}', error);
				this._notificationService.error(errorMessage);
			});

		switch (this._newFolderConfig.folderTemplate) {
			case FolderTemplate.PythonProject:
				await this._fileService.createFile(joinPath(folderRoot, '.gitignore'), VSBuffer.fromString(DOT_IGNORE_PYTHON))
					.catch((error) => {
						this._handleGitIgnoreError(error);
					});
				break;
			case FolderTemplate.RProject:
				await this._fileService.createFile(joinPath(folderRoot, '.gitignore'), VSBuffer.fromString(DOT_IGNORE_R))
					.catch((error) => {
						this._handleGitIgnoreError(error);
					});
				break;
			case FolderTemplate.JupyterNotebook:
				await this._fileService.createFile(joinPath(folderRoot, '.gitignore'), VSBuffer.fromString(DOT_IGNORE_JUPYTER))
					.catch((error) => {
						this._handleGitIgnoreError(error);
					});
				break;
			case FolderTemplate.EmptyProject:
				// Empty projects don't need a .gitignore file
				break;
			default:
				this._logService.error(
					'Cannot determine .gitignore content for unknown folder template',
					this._newFolderConfig.folderTemplate
				);
				break;
		}

		this._removePendingInitTask(NewFolderTask.Git);
	}

	/**
	 * Creates the Python environment.
	 * Relies on extension ms-python.python
	 *
	 * NOTE: This method writes to `_runtimeMetadata`. It is called by both
	 * `_runPythonTasks` and `_runJupyterTasks`, which may run in parallel.
	 * This is safe because only one language task is active per folder
	 * template (Python OR Jupyter, never both).
	 */
	private async _createPythonEnvironment(): Promise<boolean> {
		if (this._newFolderConfig) {
			const provider = this._newFolderConfig.pythonEnvProviderId;
			if (provider && provider.length > 0) {
				const runtimeMetadata = this._newFolderConfig.runtimeMetadata;
				const condaPythonVersion = this._newFolderConfig.condaPythonVersion;
				const uvPythonVersion = this._newFolderConfig.uvPythonVersion;

				// Ensure the workspace folder is available
				const workspaceFolder =
					this._contextService.getWorkspace().folders[0];

				if (!workspaceFolder) {
					const message = this._failedPythonEnvMessage(
						`Could not determine workspace folder for ${this._newFolderConfig.folderPath}.`
					);
					this._logService.error(message);
					this._notificationService.warn(message);
					this._removePendingInitTask(NewFolderTask.PythonEnvironment);
					return false;
				}

				// Ensure the Python interpreter path is available. This is the global Python
				// interpreter to use for the new environment. This is only required if we are not
				// using a conda or uv environment.
				const interpreterPath = (runtimeMetadata?.extraRuntimeData as { pythonPath?: string } | undefined)?.pythonPath;
				if (!interpreterPath && !condaPythonVersion && !uvPythonVersion) {
					const message = this._failedPythonEnvMessage('Could not determine Python interpreter path for new folder.');
					this._logService.error(message);
					this._notificationService.warn(message);
					this._removePendingInitTask(NewFolderTask.PythonEnvironment);
					return false;
				}

				// Create the Python environment
				// Note: this command will show a quick pick to select the Python interpreter if the
				// specified Python interpreter is invalid for some reason (e.g. for Venv, if the
				// specified interpreter is not considered to be a Global Python installation).
				const createEnvCommand = 'python.createEnvironmentAndRegister';
				const envName = this._newFolderConfig.pythonEnvName;
				const result: CreateEnvironmentResult | undefined =
					await this._commandService.executeCommand(
						createEnvCommand,
						{
							workspaceFolder,
							providerId: provider,
							interpreterPath,
							condaPythonVersion,
							uvPythonVersion,
							envName,
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
					this._removePendingInitTask(NewFolderTask.PythonEnvironment);
					return false;
				}

				// Set the runtime metadata for the new folder, whether it's undefined or not.
				this._runtimeMetadata = result.metadata;

				// Check if the newly created runtime metadata was returned
				if (!result.metadata) {
					// Warn the user, but don't exit early. We'll still try to
					// continue since the environment creation was successful.
					const message = this._failedPythonEnvMessage(`Could not determine interpreter metadata returned from ${createEnvCommand} command. The interpreter may need to be selected manually.`);
					this._logService.error(message);
					this._notificationService.warn(message);
				}

				this._removePendingInitTask(NewFolderTask.PythonEnvironment);

				return true;
			}
		} else {
			// This shouldn't occur.
			const message = this._failedPythonEnvMessage('Could not determine runtime metadata for new folder.');
			this._logService.error(message);
			this._notificationService.warn(message);
			this._removePendingInitTask(NewFolderTask.PythonEnvironment);
			return false;
		}
		// No provider configured - no environment was created.
		return false;
	}

	/**
	 * Adds the pyproject.toml file.
	 * Relies on the positron-python extension.
	 */
	private async _createPyprojectToml() {
		// Use the selected Python version for the `requires-python` field if available.
		let minPythonVersion: string | undefined;
		if (this._runtimeMetadata?.languageVersion) {
			minPythonVersion = this._runtimeMetadata.languageVersion;
		}

		const result = await this._commandService.executeCommand<CreatePyprojectTomlResult>(
			'python.createPyprojectToml', minPythonVersion
		);
		if (!result || !result.success) {
			const errorDesc = result?.error ? result.error : 'unknown error';
			const message = this._failedPythonEnvMessage(`Failed to create pyproject.toml: ${errorDesc}`);
			this._logService.error(message);
			this._notificationService.warn(message);
		}

		this._removePendingInitTask(NewFolderTask.CreatePyprojectToml);
	}

	/**
	 * Returns a localized message for a failed Python environment creation.
	 * @param reason The reason for the failure.
	 * @returns The localized message.
	 */
	private _failedPythonEnvMessage(reason: string): string {
		if (!this._newFolderConfig) {
			return '';
		}
		const {
			folderName,
			folderTemplate,
			pythonEnvProviderName
		} = this._newFolderConfig;

		const message = localize(
			'positron.newFolderService.failedPythonEnvMessage',
			"Failed to create {0} environment for new {1} '{2}': {3}",
			pythonEnvProviderName,
			folderTemplate,
			folderName,
			reason
		);
		return message;
	}

	/**
	 * Creates the R environment.
	 * Relies on extension positron.positron-r
	 */
	private async _createREnvironment() {
		if (this._newFolderConfig?.useRenv) {
			await this._commandService.executeCommand('r.renvInit');
		}
		this._removePendingPostInitTask(NewFolderTask.REnvironment);
	}

	//#endregion Extension Tasks


	/**
	 * Centralised validation helper for notebook connection.
	 * Prefers the active notebook editor if present, otherwise falls back to the only open notebook editor.
	 * If no notebook editors are open, or no active notebook editor is present when multiple are open, logs and notifies the user.
	 *
	 * @returns The validated context required to establish a runtime session, or `undefined` if validation failed.
	 */
	private _getNotebookContext(): { model: INotebookTextModel; runtimeId: string } | undefined {
		const notebookEditors = this._notebookEditorService.listNotebookEditors();

		// Prefer the active notebook editor if available
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const activeEditor = (this._notebookEditorService as any).activeNotebookEditor as { textModel?: INotebookTextModel } | undefined;
		const editor = activeEditor?.textModel
			? activeEditor
			: (notebookEditors.length === 1 ? notebookEditors[0] : undefined);

		if (!editor || !editor.textModel) {
			if (notebookEditors.length === 0) {
				this._logService.debug(`${this._nbLogPrefix} No notebook editor found for connection.`);
				this._notificationService.warn('No notebook editor is open. Please open a notebook to connect it to the new environment.');
			} else {
				this._logService.error(`${this._nbLogPrefix} No active notebook editor found among multiple open editors.`);
				this._notificationService.error('Multiple notebook editors are open, but none is active. Please focus the notebook you want to connect.');
			}
			return undefined;
		}

		const textModel = editor.textModel;
		if (!textModel.uri) {
			this._logService.debug(`${this._nbLogPrefix} Notebook text model has no URI.`);
			return undefined;
		}

		const runtimeId = this._runtimeMetadata?.runtimeId;
		if (!runtimeId) {
			this._logService.error(`${this._nbLogPrefix} No runtime ID available for connection.`);
			return undefined;
		}

		return { model: textModel, runtimeId };
	}

	/**
	 * Provides automatic notebook-to-runtime connection as the final step in notebook folder creation.
	 * This addresses issue #7285 where newly created notebooks weren't automatically connecting.
	 * Without this connection, users would face confusing manual setup steps that contradict
	 * the streamlined folder creation experience we're aiming for.
	 *
	 * @param sessionListener The event listener for runtime start, used to dispose itself upon completion or error.
	 */
	private async _connectNotebookToRuntime(sessionListener: IDisposable): Promise<void> {
		try {
			// Validate context in a single place
			const context = this._getNotebookContext();
			if (!context) {
				return; // All logging handled by helper
			}

			const { model, runtimeId } = context;
			const sessionName = this._newFolderConfig?.folderName ?? 'New Folder Notebook';

			// Start / attach runtime session
			try {
				await this._runtimeSessionService.startNewRuntimeSession(
					runtimeId,
					sessionName,
					LanguageRuntimeSessionMode.Notebook,
					model.uri,
					'New Folder Notebook Creation',
					RuntimeStartMode.Starting,
					true
				);
				this._logService.debug(`${this._nbLogPrefix} Connected notebook ${model.uri.toString()} to runtime ${runtimeId}`);
			} catch (error) {
				this._logService.error(`${this._nbLogPrefix} Failed to connect notebook to runtime: ${String(error)}`);
				// Show a user-facing error toast, but do not break the flow
				this._notificationService.error('Failed to start the runtime environment for your new notebook. You may need to select or start an environment manually.');
				return;
			}

			// Select kernel
			await this._selectKernelForNotebook(model);
		} catch (error) {
			this._logService.error(`${this._nbLogPrefix} Error during post-init notebook setup: ${String(error)}`);
			this._notificationService.error(localize('positronNewFolderService.postInitNotebookError', 'Error setting up notebook for new folder: {0}', String(error)));
		} finally {
			sessionListener.dispose();
		}
	}

	/**
	 * Waits for a kernel matching the given runtimePath to be registered for the notebook.
	 * Listens to notebookKernelService.onDidAddKernel to avoid polling. Falls back after 10 s.
	 *
	 * @param notebookTextModel The notebook text model to select a kernel for
	 * @param runtimePath The interpreter path to match.
	 */
	private async _waitForKernelRegistration(
		notebookTextModel: INotebookTextModel,
		runtimePath: string,
	): Promise<INotebookKernel | undefined> {
		// Helper to find a matching kernel among currently known ones
		const findMatch = (): INotebookKernel | undefined => {
			const matching = this._notebookKernelService.getMatchingKernel(notebookTextModel);
			return matching.all.find(k => k.description === runtimePath);
		};

		// Return immediately if a kernel is already registered
		const existing = findMatch();
		if (existing) {
			return existing;
		}

		return new Promise<INotebookKernel | undefined>((resolve) => {
			// Listener for newly-added kernels
			const disposable = this._notebookKernelService.onDidAddKernel((kernel) => {
				if (kernel.description === runtimePath) {
					disposable.dispose();
					resolve(kernel);
				}
			});

			// Fallback timeout (10 s)
			setTimeout(() => {
				disposable.dispose();
				resolve(undefined);
			}, 10000);
		});
	}

	/**
	 * Ensures the notebook has a properly selected kernel that matches the folders's runtime.
	 * This eliminates the need for manual kernel selection when creating a new notebook folder.
	 *
	 * If no suitable kernel is found, a user-facing error notification is shown, but the flow continues.
	 *
	 * @param notebookTextModel The notebook text model to select a kernel for
	 */
	private async _selectKernelForNotebook(notebookTextModel: INotebookTextModel) {
		const runtimePath: string | undefined = this._runtimeMetadata?.runtimePath;
		const languageId = this._runtimeMetadata?.languageId;
		this._logService.debug('[New folder startup] Kernel selection: runtimePath=', runtimePath);

		const matchingInitial = this._notebookKernelService.getMatchingKernel(notebookTextModel);
		// If a kernel is already selected and it doesn't match our runtime, decide if we should override.
		if (runtimePath && matchingInitial.selected && matchingInitial.selected.description !== runtimePath) {
			const hasExecuted = notebookTextModel.cells.some(cell => typeof cell.internalMetadata?.executionOrder === 'number');
			if (!hasExecuted) {
				this._logService.debug('[New folder startup] Overriding pre-selected kernel because notebook has no execution history.');
				// We simply clear the selection; the subsequent logic will select the correct kernel.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				this._notebookKernelService.selectKernelForNotebook(undefined as any, notebookTextModel);
			}
		}

		let kernelToSelect: INotebookKernel | undefined;

		if (runtimePath) {
			// Wait for the kernel to be registered if needed
			kernelToSelect = await this._waitForKernelRegistration(notebookTextModel, runtimePath);
			if (kernelToSelect) {
				this._logService.debug(`[New folder startup] Kernel '${kernelToSelect.id}' selected: exact match for runtimePath after polling.`);
			}
		}

		if (!kernelToSelect) {
			// Fallback to previous logic if polling failed
			const matchingKernels = this._notebookKernelService.getMatchingKernel(notebookTextModel);
			if (!runtimePath) {
				for (const kernel of matchingKernels.all) {
					if (kernel.extension.value.includes('positron') && languageId && kernel.supportedLanguages.includes(languageId)) {
						this._logService.debug(`[New folder startup] Kernel '${kernel.id}' selected: Positron-specific for language (no venv).`);
						kernelToSelect = kernel;
						break;
					}
				}
			} else {
				// If we have a runtimePath but polling failed, warn the user
				this._logService.warn('[New folder startup] No kernel registered for the new environment after waiting. Falling back to best available kernel.');
				for (const kernel of matchingKernels.all) {
					if (kernel.description && kernel.description.includes('.venv')) {
						kernelToSelect = kernel;
						break;
					}
				}
			}
		}

		if (!kernelToSelect) {
			// Show a user-facing error toast, but do not break the flow
			this._notificationService.error('No matching Jupyter kernel was found for the new environment. You will need to select a kernel manually in the notebook.');
			this._logService.debug(`[New folder startup] No suitable kernel found for notebook`);
			return;
		}

		this._notebookKernelService.selectKernelForNotebook(kernelToSelect, notebookTextModel);
		this._logService.debug(`[New folder startup] Selected kernel ${kernelToSelect.id} for notebook`);
		return;
	}

	/**
	 * Removes a pending init task.
	 */
	private _removePendingInitTask(task: NewFolderTask) {
		const updatedPendingTasks = new Set(this.pendingInitTasks);
		updatedPendingTasks.delete(task);
		this._pendingInitTasks.set(updatedPendingTasks, undefined);
	}

	/**
	 * Removes a pending post-init task.
	 */
	private _removePendingPostInitTask(task: NewFolderTask) {
		const updatedPendingTasks = new Set(this.pendingPostInitTasks);
		updatedPendingTasks.delete(task);
		this._pendingPostInitTasks.set(updatedPendingTasks, undefined);
	}

	/**
	 * Returns the tasks that need to be performed for the new folder.
	 */
	private _getInitTasks(): Set<NewFolderTask> {
		if (!this._newFolderConfig) {
			return new Set();
		}

		const tasks = new Set<NewFolderTask>();
		switch (this._newFolderConfig.folderTemplate) {
			case FolderTemplate.PythonProject:
				tasks.add(NewFolderTask.Python);
				if (this._newFolderConfig.pythonEnvProviderId) {
					tasks.add(NewFolderTask.PythonEnvironment);
				}
				if (this._newFolderConfig.createPyprojectToml) {
					tasks.add(NewFolderTask.CreatePyprojectToml);
				}
				break;
			case FolderTemplate.JupyterNotebook:
				tasks.add(NewFolderTask.Jupyter);
				// For now, Jupyter notebooks are always Python based.
				if (this._newFolderConfig.pythonEnvProviderId) {
					tasks.add(NewFolderTask.PythonEnvironment);
				}
				break;
			case FolderTemplate.RProject:
				tasks.add(NewFolderTask.R);
				break;
			case FolderTemplate.EmptyProject:
				// Empty project doesn't have any language-specific tasks
				break;
			default:
				this._logService.error(
					'Cannot determine new folder tasks for unknown folder template',
					this._newFolderConfig.folderTemplate
				);
				return new Set();
		}

		if (this._newFolderConfig.initGitRepo) {
			tasks.add(NewFolderTask.Git);
		}

		// Create a new file for language-specific templates. Empty projects don't create a file.
		if (this._newFolderConfig.folderTemplate !== FolderTemplate.EmptyProject) {
			tasks.add(NewFolderTask.CreateNewFile);
		}

		return tasks;
	}

	/**
	 * Returns the post initialization tasks that need to be performed for the new folder.
	 * @returns Returns the post initialization tasks that need to be performed for the new folder.
	 */
	private _getPostInitTasks(): Set<NewFolderTask> {
		if (!this._newFolderConfig) {
			return new Set();
		}

		// Set up the runtime session listener
		const sessionListener = this._runtimeSessionService.onDidStartRuntime(async (runtimeSession) => {
			this._logService.debug(`[New folder startup] Runtime ${runtimeSession.sessionId} created. Running post-init tasks.`);
			this._startupPhase.set(NewFolderStartupPhase.PostInitialization, undefined);

			// If we've created a Jupyter Notebook folder we need to connect the notebook to the runtime.
			if (this._newFolderConfig?.folderTemplate === FolderTemplate.JupyterNotebook) {
				// Pass the listener itself to the connection method to allow self-disposal
				await this._connectNotebookToRuntime(sessionListener);
			} else {
				// For non-notebook folders, dispose the listener immediately
				sessionListener.dispose();
			}
		});

		// Register the listener with the service's disposables to ensure cleanup
		// if the service is disposed before the listener self-disposes
		this._register(sessionListener);

		const tasks = new Set<NewFolderTask>();
		if (this._newFolderConfig.useRenv) {
			tasks.add(NewFolderTask.REnvironment);
		}

		return tasks;
	}

	//#endregion Private Methods

	//#region Public Methods

	isCurrentWindowNewFolder() {
		// There is no new folder configuration, so a new folder was not created.
		if (!this._newFolderConfig) {
			return false;
		}
		const folder = this._contextService.getWorkspace().folders.at(0);
		if (!folder) {
			return false;
		}
		const currentFolderPath = folder.uri;
		const newFolderPath = URI.from({
			scheme: this._newFolderConfig.folderScheme,
			authority: this._newFolderConfig.folderAuthority,
			path: this._newFolderConfig.folderPath
		});
		const currentWindowIsNewFolder = relativePath(currentFolderPath, newFolderPath) === '';
		this._logService.debug(`[New folder startup] Current window is new folder: ${currentWindowIsNewFolder}`);
		return currentWindowIsNewFolder;
	}

	async initNewFolder() {
		if (!this.isCurrentWindowNewFolder()) {
			// The constructor already opened the barrier for non-new-folder
			// windows. Nothing else to do here.
			return;
		}
		if (this._newFolderConfig) {
			// We're in the new folder window, so we can clear the config from the storage service.
			this.clearNewFolderConfig();

			// Apply layout before awaiting trust since layout changes don't require trust.
			this._startupPhase.set(
				NewFolderStartupPhase.ApplyLayout,
				undefined
			);
			this._applyLayout().catch((error) => {
				this._logService.error('[New folder startup] Error applying layout:', error);
			});

			this._startupPhase.set(
				NewFolderStartupPhase.AwaitingTrust,
				undefined
			);

			// Ensure the workspace is trusted before proceeding with new folder tasks
			if (this._workspaceTrustManagementService.isWorkspaceTrusted()) {
				this._newFolderTasks();
			} else {
				this._register(
					this._workspaceTrustManagementService.onDidChangeTrust(
						(trusted) => {
							if (!trusted) {
								return;
							}
							if (
								this.startupPhase ===
								NewFolderStartupPhase.AwaitingTrust
							) {
								// Trust was granted. Now we can proceed with the new folder tasks.
								this._newFolderTasks();
							}
						}
					)
				);
			}
		} else {
			this._logService.error(
				'[New folder startup] No new folder configuration found'
			);
			this._notificationService.error(
				'Failed to create new folder. No new folder configuration found.'
			);
			this._startupPhase.set(NewFolderStartupPhase.Complete, undefined);
		}
	}

	clearNewFolderConfig() {
		this._storageService.remove(
			POSITRON_NEW_FOLDER_CONFIG_STORAGE_KEY,
			StorageScope.APPLICATION
		);
	}

	storeNewFolderConfig(newfolderConfig: NewFolderConfiguration) {
		this._storageService.store(
			POSITRON_NEW_FOLDER_CONFIG_STORAGE_KEY,
			JSON.stringify(newfolderConfig),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE
		);
	}

	//#endregion Public Methods

	//#region Getters and Setters

	/**
	 * Returns the current startup phase.
	 */
	get startupPhase(): NewFolderStartupPhase {
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
	 * Returns the runtime metadata for the new folder.
	 */
	public get newFolderRuntimeMetadata(): ILanguageRuntimeMetadata | undefined {
		return this._runtimeMetadata;
	}

	//#endregion Getters and Setters
}
