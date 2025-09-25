/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { PositronDataExplorerUri } from '../common/positronDataExplorerUri.js';
import { DataExplorerClientInstance, DataExplorerUiEvent } from '../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { PositronDataExplorerInstance } from './positronDataExplorerInstance.js';
import { ILanguageRuntimeSession, IRuntimeClientInstance, IRuntimeSessionService, RuntimeClientType } from '../../runtimeSession/common/runtimeSessionService.js';
import { IPositronDataExplorerService } from './interfaces/positronDataExplorerService.js';
import { IPositronDataExplorerInstance } from './interfaces/positronDataExplorerInstance.js';
import { PositronDataExplorerComm } from '../../languageRuntime/common/positronDataExplorerComm.js';
import { PositronDataExplorerDuckDBBackend } from '../common/positronDataExplorerDuckDBBackend.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { URI } from '../../../../base/common/uri.js';
import { RuntimeState } from '../../languageRuntime/common/languageRuntimeService.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/**
 * DataExplorerRuntime class.
 */
class DataExplorerRuntime extends Disposable {
	//#region Private Properties

	/**
	 * The onDidOpenDataExplorerClient event emitter.
	 */
	private readonly _onDidOpenDataExplorerClientEmitter =
		this._register(new Emitter<DataExplorerClientInstance>);

	/**
	 * The onDidCloseDataExplorerClient event emitter.
	 */
	private readonly _onDidCloseDataExplorerClientEmitter =
		this._register(new Emitter<DataExplorerClientInstance>);

	//#endregion Private Properties

	/**
	 * The onDidOpenDataExplorerClient event.
	 */
	readonly onDidOpenDataExplorerClient = this._onDidOpenDataExplorerClientEmitter.event;

	/**
	 * The onDidCloseDataExplorerClient event.
	 */
	readonly onDidCloseDataExplorerClient = this._onDidCloseDataExplorerClientEmitter.event;

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _notificationService The notification service.
	 * @param _session The session.
	 */
	constructor(
		private readonly _notificationService: INotificationService,
		private readonly _session: ILanguageRuntimeSession
	) {
		// Call the disposable constrcutor.
		super();

		/**
		 * Add the onDidCreateClientInstance event handler.
		 */
		this._register(this._session.onDidCreateClientInstance(async e => {
			try {
				// Ignore client types we don't process.
				if (e.client.getClientType() !== RuntimeClientType.DataExplorer) {
					return;
				}

				// Create and register the DataExplorerClientInstance for the client instance.
				const commInstance = new PositronDataExplorerComm(e.client);
				const dataExplorerClientInstance = new DataExplorerClientInstance(commInstance);
				this._register(dataExplorerClientInstance);

				// Register the onDidClose event handler on the DataExplorerClientInstance
				// so that we can clean up the instance when it is closed.
				this._register(dataExplorerClientInstance.onDidClose(() => {
					this._onDidCloseDataExplorerClientEmitter.fire(dataExplorerClientInstance);
				}));

				// Raise the onDidOpenDataExplorerClient event.
				this._onDidOpenDataExplorerClientEmitter.fire(dataExplorerClientInstance);
			} catch (err) {
				this._notificationService.error(`Can't open data explorer: ${err.message}`);
			}
		}));
	}

	//#endregion Constructor & Dispose
}

/**
 * PositronDataExplorerService class.
 */
class PositronDataExplorerService extends Disposable implements IPositronDataExplorerService {
	//#region Private Properties

	/**
	 * A map of the data explorer runtimes keyed by session ID.
	 */
	private readonly _dataExplorerRuntimes = new Map<string, DataExplorerRuntime>();

	/**
	 * The Positron data explorer instances keyed by data explorer client instance identifier.
	 */
	private _positronDataExplorerInstances = new Map<string, PositronDataExplorerInstance>();

	/**
	 * The Positron data explorer variable-to-instance map.
	 */
	private _varIdToInstanceIdMap = new Map<string, string>();

	/**
	 * A registry for events routed to a data explorer via vscode's command system
	 */
	private _uiEventCommandHandlers = new Map<
		string, (event: DataExplorerUiEvent) => void
	>();

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 */
	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IEditorService private readonly _editorService: IEditorService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService
	) {
		// Call the disposable constructor.
		super();

		// Add a data explorer runtime for each running runtime.
		this._runtimeSessionService.activeSessions.forEach(async session => {
			await this.attachSession(session);
		});

		// Register the onWillStartSession event handler.
		this._register(this._runtimeSessionService.onWillStartSession(async e => {
			await this.attachSession(e.session);
		}));

		// Register the onDidStartRuntime event handler.
		this._register(this._runtimeSessionService.onDidStartRuntime(runtime => {
			// console.log(`++++++++++ PositronDataExplorerService: onDidStartRuntime ${runtime.metadata.runtimeId}`);
		}));

		// Register the onDidFailStartRuntime event handler.
		this._register(this._runtimeSessionService.onDidFailStartRuntime(runtime => {
			// console.log(`++++++++++ PositronDataExplorerService: onDidFailStartRuntime ${runtime.metadata.runtimeId}`);
		}));

		// Register the onDidChangeRuntimeState event handler.
		this._register(this._runtimeSessionService.onDidChangeRuntimeState(stateEvent => {
			// console.log(`++++++++++ PositronDataExplorerService: onDidChangeRuntimeState from ${stateEvent.old_state} to ${stateEvent.new_state}`);
		}));

		// This is a temporary mechanism for extensions like positron-duckdb implementing
		// a data explorer backend to be able to invoke the frontend methods
		// (updates, async column profiles) normally invoked by a language runtime kernel
		this._register(CommandsRegistry.registerCommand('positron-data-explorer.sendUiEvent',
			(accessor: ServicesAccessor, event: DataExplorerUiEvent) => {
				const handler = this._uiEventCommandHandlers.get(event.uri.toString());

				// If not event handler registered, ignore for now
				if (handler === undefined) {
					return;
				}

				return handler(event);
			}
		));
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// Dispose of the data explorer runtimes.
		this._dataExplorerRuntimes.forEach(dataExplorerRuntime => {
			dataExplorerRuntime.dispose();
		});

		// Clear the data explorer runtimes.
		this._dataExplorerRuntimes.clear();

		// Call the base class's dispose method.
		super.dispose();
	}

	/**
	 * Gets the Positron data explorer instance for the specified variable.
	 *
	 * @param variableId The variable ID.
	 * @returns The Positron data explorer instance.
	 */
	getInstanceForVar(variableId: string): IPositronDataExplorerInstance | undefined {
		const instanceId = this._varIdToInstanceIdMap.get(variableId);
		if (instanceId === undefined) {
			return undefined;
		}
		return this._positronDataExplorerInstances.get(instanceId);
	}

	/**
	 * Sets the instance for the specified variable.
	 *
	 * It's OK if the instance doesn't exist yet; this binding will be used when
	 * the instance is created.
	 *
	 * @param instanceId The instance ID.
	 * @param variableId The variable ID.
	 */
	setInstanceForVar(instanceId: string, variableId: string): void {
		this._varIdToInstanceIdMap.set(variableId, instanceId);
	}

	//#endregion Constructor & Dispose

	//#region IPositronDataExplorerService Implementation

	/**
	 * Needed for service branding in dependency injector.
	 */
	declare readonly _serviceBrand: undefined;


	/**
	 * Placeholder that gets called to "initialize" the PositronDataExplorerService.
	 */
	initialize() {
	}

	/**
	 * Gets a Positron data explorer instance.
	 * @param identifier The identifier of the Positron data explorer instance.
	 */
	getInstance(identifier: string): IPositronDataExplorerInstance | undefined {
		return this._positronDataExplorerInstances.get(identifier);
	}

	/**
	 * Open a workspace file using the positron-duckdb extension for use with
	 * the data explorer.
	 * @param filePath Path to file to open with positron-duckdb extension
	 */
	async openWithDuckDB(uri: URI) {
		const backend = new PositronDataExplorerDuckDBBackend(this._commandService, uri);

		// Associate UI events (like ReturnColumnProfiles) for this file path
		// with this backend. We're presuming only one backend per file path, so
		// if we need multiple backends per file path we can extend
		this._uiEventCommandHandlers.set(uri.toString(), (event) => {
			backend.handleUiEvent(event);
		});

		// TODO: error handling if opening the file failed

		const client = new DataExplorerClientInstance(backend);
		this.registerDataExplorerClient('duckdb', client);
	}

	//#endregion IPositronDataExplorerService Implementation

	//#region Private Methods

	/**
	 * Attach a session to the Positron data explorer service.
	 *
	 * If the session is being reattached, we wait for it to become idle before
	 * adding it.
	 *
	 * @param session
	 */
	private async attachSession(session: ILanguageRuntimeSession) {
		if (this._dataExplorerRuntimes.has(session.sessionId) &&
			session.getRuntimeState() !== RuntimeState.Idle) {
			const disposable = this._register(
				session.onDidChangeRuntimeState(async newState => {
					if (newState === RuntimeState.Idle) {
						// If the runtime is idle, we can add the data explorer session.
						disposable.dispose();
						await this.addDataExplorerSession(session);
					}
				}));
		} else {
			// If the runtime is already idle, we can add the data explorer session.
			await this.addDataExplorerSession(session);
		}
	}

	/**
	 * Adds a data explorer runtime.
	 *
	 * @param session The runtime session.
	 */
	private async addDataExplorerSession(session: ILanguageRuntimeSession) {
		// If the runtime has already been added, check if we need to open a Data Explorer client.
		if (this._dataExplorerRuntimes.has(session.sessionId)) {
			// Get the Data Explorer clients for the session.
			const sessionClients: Array<IRuntimeClientInstance<any, any>> = [];
			try {
				sessionClients.push(...await session.listClients(RuntimeClientType.DataExplorer));
			} catch (err) {
				this._logService.error('Error listing Data Explorer clients:', err);
			}

			// For each client, check if we already have a Data Explorer client instance.
			for (const client of sessionClients) {
				const existingInstance = this.getInstance(client.getClientId());
				// If we don't have a Data Explorer client instance, create one and open the editor.
				if (!existingInstance) {
					const commInstance = new PositronDataExplorerComm(client);
					const dataExplorerClientInstance = new DataExplorerClientInstance(commInstance);
					this.openEditor(session.runtimeMetadata.languageName, dataExplorerClientInstance);
				}
			}

			// Dispose the old DataExplorerRuntime if it exists and create a new
			// one below; even if the session IDs match, the session's event
			// handlers may need to be reattached (e.g. if the extension host
			// restarted)
			const dataExplorerRuntime = this._dataExplorerRuntimes.get(session.sessionId);
			dataExplorerRuntime?.dispose();
			this._dataExplorerRuntimes.delete(session.sessionId);
		}

		// Create and add the data explorer runtime.
		const dataExplorerRuntime = new DataExplorerRuntime(this._notificationService, session);
		this._dataExplorerRuntimes.set(session.sessionId, dataExplorerRuntime);

		// Add the onDidOpenDataExplorerClient event handler.
		this._register(
			dataExplorerRuntime.onDidOpenDataExplorerClient(dataExplorerClientInstance => {
				this.openEditor(session.runtimeMetadata.languageName, dataExplorerClientInstance);
			})
		);

		// Add the onDidCloseDataExplorerClient event handler.
		this._register(
			dataExplorerRuntime.onDidCloseDataExplorerClient(dataExplorerClientInstance => {
				this.closeEditor(dataExplorerClientInstance);
			})
		);
	}

	/**
	 * Opens the editor for the specified DataExplorerClientInstance.
	 * @param languageName The language name.
	 * @param dataExplorerClientInstance The DataExplorerClientInstance for the editor.
	 */
	private async openEditor(
		languageName: string,
		dataExplorerClientInstance: DataExplorerClientInstance
	): Promise<void> {
		// Ensure that only one editor is open for the specified DataExplorerClientInstance.
		if (this._positronDataExplorerInstances.has(dataExplorerClientInstance.identifier)) {
			return;
		}

		this.registerDataExplorerClient(languageName, dataExplorerClientInstance);

		// Open an editor for the Positron data explorer client instance.
		const editorPane = await this._editorService.openEditor({
			resource: PositronDataExplorerUri.generate(dataExplorerClientInstance.identifier)
		});

		// If the editor could not be opened, notify the user and return.
		if (!editorPane) {
			this._notificationService.error(localize(
				'positron.dataExplorer.couldNotOpenEditor',
				"An editor could not be opened."
			));
			return;
		}
	}

	/**
	 * Registers a DataExplorerClientInstance so that it is available when the
	 * PositronDataExplorerEditor is instantiated.
	 */
	private registerDataExplorerClient(languageName: string, client: DataExplorerClientInstance) {
		// Set the Positron data explorer client instance.
		this._positronDataExplorerInstances.set(
			client.identifier,
			new PositronDataExplorerInstance(
				languageName,
				client
			)
		);

		this._register(client.onDidClose(() => {
			// When the data explorer client instance is closed, clean up
			// references to variables. We may still need to keep the instance
			// map since the defunct instances may still be bound to open
			// editors.
			for (const [key, value] of this._varIdToInstanceIdMap.entries()) {
				if (value === client.identifier) {
					this._varIdToInstanceIdMap.delete(key);
				}
			}
		}));
	}

	/**
	 * Closes the editor for the specified DataExplorerClientInstance.
	 * @param dataExplorerClientInstance The DataExplorerClientInstance for the editor.
	 */
	private closeEditor(dataExplorerClientInstance: DataExplorerClientInstance) {
		// Get the data explorer client instance. If it was found, delete it and dispose it.
		const positronDataExplorerInstance = this._positronDataExplorerInstances.get(
			dataExplorerClientInstance.identifier
		);
		if (positronDataExplorerInstance) {
			this._positronDataExplorerInstances.delete(dataExplorerClientInstance.identifier);
			positronDataExplorerInstance.dispose();
		}
	}

	//#endregion Private Methods
}

// Register the Positron data explorer service.
registerSingleton(
	IPositronDataExplorerService,
	PositronDataExplorerService,
	InstantiationType.Delayed
);
