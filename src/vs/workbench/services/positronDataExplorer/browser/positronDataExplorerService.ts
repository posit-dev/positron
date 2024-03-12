/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronDataExplorerUri } from 'vs/workbench/services/positronDataExplorer/common/positronDataExplorerUri';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { PositronDataExplorerInstance } from 'vs/workbench/services/positronDataExplorer/browser/positronDataExplorerInstance';
import { IPositronDataExplorerService } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';
import { IPositronDataExplorerInstance } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance';
import { ILanguageRuntimeSession, IRuntimeSessionService, RuntimeClientType } from '../../runtimeSession/common/runtimeSessionService';

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
	 *
	 * @param runtime
	 */
	constructor(
		private readonly _session: ILanguageRuntimeSession,
		private readonly _notificationService: INotificationService
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
				const dataExplorerClientInstance = new DataExplorerClientInstance(e.client);
				this._register(dataExplorerClientInstance);

				// Add the onDidClose event handler on the DataExplorerClientInstance,
				dataExplorerClientInstance.onDidClose(() => {
					this._onDidCloseDataExplorerClientEmitter.fire(dataExplorerClientInstance);
				});

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
	private readonly _dataExplorerSessions = new Map<string, DataExplorerRuntime>();

	/**
	 * The Positron data explorer instance map keyed by
	 */
	private _positronDataExplorerInstanceMap = new Map<string, PositronDataExplorerInstance>();

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _editorService The editor service.
	 * @param _runtimeSessionService The language runtime session service.
	 * @param _notificationService The notification service.
	 */
	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@INotificationService private readonly _notificationService: INotificationService
	) {
		// Call the disposable constrcutor.
		super();

		// Add a data explorer runtime for each running runtime.
		this._runtimeSessionService.activeSessions.forEach(session => {
			this.addDataExplorerSession(session);
		});

		// Register the onWillStartSession event handler.
		this._register(this._runtimeSessionService.onWillStartSession(e => {
			this.addDataExplorerSession(e.session);
		}));

		// Register the onDidStartRuntime event handler.
		this._register(this._runtimeSessionService.onDidStartRuntime(runtime => {
			// console.log(`++++++++++ PositronDataExplorerService: onDidStartRuntime ${runtime.metadata.runtimeId}`);
		}));

		// Register the onDidFailStartRuntime event handler.
		this._register(this._runtimeSessionService.onDidFailStartRuntime(runtime => {
			// console.log(`++++++++++ PositronDataExplorerService: onDidFailStartRuntime ${runtime.metadata.runtimeId}`);
		}));

		// Register the onDidReconnectRuntime event handler.
		this._register(this._runtimeSessionService.onDidReconnectRuntime(runtime => {
			// console.log(`++++++++++ PositronDataExplorerService: onDidReconnectRuntime ${runtime.metadata.runtimeId}`);
		}));

		// Register the onDidChangeRuntimeState event handler.
		this._register(this._runtimeSessionService.onDidChangeRuntimeState(stateEvent => {
			// console.log(`++++++++++ PositronDataExplorerService: onDidChangeRuntimeState from ${stateEvent.old_state} to ${stateEvent.new_state}`);
		}));
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// Dispose of the data explorer runtimes.
		this._dataExplorerSessions.forEach(dataExplorerRuntime => {
			dataExplorerRuntime.dispose();
		});

		// Clear the data explorer runtimes.
		this._dataExplorerSessions.clear();

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region IPositronDataExplorerService Implementation

	/**
	 * Needed for service branding in dependency injector.
	 */
	declare readonly _serviceBrand: undefined;

	/**
	 * Placeholder that gets called to "initialize" the PositronConsoleService.
	 */
	initialize() {
	}

	async open(dataExplorerClientInstance: DataExplorerClientInstance): Promise<void> {
		this._positronDataExplorerInstanceMap.set(
			dataExplorerClientInstance.identifier,
			new PositronDataExplorerInstance(dataExplorerClientInstance)
		);

		const start = new Date();

		// Open the editor.
		await this._editorService.openEditor({
			resource: PositronDataExplorerUri.generate(dataExplorerClientInstance.identifier)
		});

		const end = new Date();

		console.log(`this._editorService.openEditor took ${end.getTime() - start.getTime()}ms`);
	}

	/**
	 * Test open function.
	 */
	async testOpen(identifier: string): Promise<void> {
	}

	/**
	 * Gets a Positron data explorer instance.
	 * @param identifier The identifier of the Positron data explorer instance.
	 */
	getInstance(identifier: string): IPositronDataExplorerInstance | undefined {
		return this._positronDataExplorerInstanceMap.get(identifier);
	}

	//#endregion IPositronDataExplorerService Implementation

	//#region Private Methods

	/**
	 * Adds a data explorer runtime.
	 *
	 * @param session The runtime session.
	 */
	private addDataExplorerSession(session: ILanguageRuntimeSession) {
		// If the runtime has already been added, return.
		if (this._dataExplorerSessions.has(session.sessionId)) {
			return;
		}

		// Create and add the data explorer runtime.
		const dataExplorerRuntime = new DataExplorerRuntime(session, this._notificationService);
		this._dataExplorerSessions.set(session.sessionId, dataExplorerRuntime);

		dataExplorerRuntime.onDidOpenDataExplorerClient(dataExplorerClientInstance => {
			this.open(dataExplorerClientInstance);
		});

		dataExplorerRuntime.onDidCloseDataExplorerClient(dataExplorerClientInstance => {

		});
	}

	//#endregion Private Methods
}

// Register the Positron data explorer service.
registerSingleton(IPositronDataExplorerService, PositronDataExplorerService, InstantiationType.Delayed);
