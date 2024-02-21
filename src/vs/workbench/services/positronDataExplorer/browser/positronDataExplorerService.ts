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
import { ILanguageRuntime, ILanguageRuntimeService, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

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
		private readonly _runtime: ILanguageRuntime,
		private readonly _notificationService: INotificationService
	) {
		// Call the disposable constrcutor.
		super();

		/**
		 * Add the onDidCreateClientInstance event handler.
		 */
		this._register(this._runtime.onDidCreateClientInstance(async e => {
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

				// Test that we can get things.
				const foo = await dataExplorerClientInstance.getSchema(0, 1000);
				console.log(foo);
				const bar = await dataExplorerClientInstance.getDataValues(0, 10, [0, 1, 2, 3, 4, 5]);
				console.log(bar);

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
	 * A map of the data explorer runtimes keyed by runtime ID.
	 */
	private readonly _dataExplorerRuntimes = new Map<string, DataExplorerRuntime>();

	/**
	 * The Positron data explorer instance map keyed by
	 */
	private _positronDataExplorerInstanceMap = new Map<string, PositronDataExplorerInstance>();

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _editorService The editor service.
	 * @param _languageRuntimeService The language runtime service.
	 */
	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@INotificationService private readonly _notificationService: INotificationService
	) {
		// Call the disposable constrcutor.
		super();

		// Add a data explorer runtime for each running runtime.
		this._languageRuntimeService.runningRuntimes.forEach(runtime => {
			this.addDataExplorerRuntime(runtime);
		});

		// Register the onWillStartRuntime event handler.
		this._register(this._languageRuntimeService.onWillStartRuntime(runtime => {
			this.addDataExplorerRuntime(runtime);
		}));

		// Register the onDidStartRuntime event handler.
		this._register(this._languageRuntimeService.onDidStartRuntime(runtime => {
			// console.log(`++++++++++ PositronDataExplorerService: onDidStartRuntime ${runtime.metadata.runtimeId}`);
		}));

		// Register the onDidFailStartRuntime event handler.
		this._register(this._languageRuntimeService.onDidFailStartRuntime(runtime => {
			// console.log(`++++++++++ PositronDataExplorerService: onDidFailStartRuntime ${runtime.metadata.runtimeId}`);
		}));

		// Register the onDidReconnectRuntime event handler.
		this._register(this._languageRuntimeService.onDidReconnectRuntime(runtime => {
			// console.log(`++++++++++ PositronDataExplorerService: onDidReconnectRuntime ${runtime.metadata.runtimeId}`);
		}));

		// Register the onDidChangeRuntimeState event handler.
		this._register(this._languageRuntimeService.onDidChangeRuntimeState(stateEvent => {
			// console.log(`++++++++++ PositronDataExplorerService: onDidChangeRuntimeState from ${stateEvent.old_state} to ${stateEvent.new_state}`);
		}));
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

		// Open the editor.
		await this._editorService.openEditor({
			resource: PositronDataExplorerUri.generate(dataExplorerClientInstance.identifier)
		});
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
	 * @param runtime The runtime.
	 */
	private addDataExplorerRuntime(runtime: ILanguageRuntime) {
		// If the runtime has already been added, return.
		if (this._dataExplorerRuntimes.has(runtime.metadata.runtimeId)) {
			return;
		}

		// Create and add the data explorer runtime.
		const dataExplorerRuntime = new DataExplorerRuntime(runtime, this._notificationService);
		this._dataExplorerRuntimes.set(runtime.metadata.runtimeId, dataExplorerRuntime);

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
