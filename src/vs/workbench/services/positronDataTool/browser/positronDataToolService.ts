/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronDataToolUri } from 'vs/workbench/services/positronDataTool/common/positronDataToolUri';
import { PositronDataToolInstance } from 'vs/workbench/services/positronDataTool/browser/positronDataToolInstance';
import { DataToolClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataToolClient';
import { IPositronDataToolService } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolService';
import { IPositronDataToolInstance } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolInstance';
import { ILanguageRuntime, ILanguageRuntimeService, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * DataToolRuntime class.
 */
class DataToolRuntime extends Disposable {
	//#region Private Properties

	/**
	 * A map of the data tool client instances.
	 */
	// private readonly _dataToolClientInstances = new Set<DataToolClientInstance>();

	/**
	 * The onDidOpenDataToolClient event emitter.
	 */
	private readonly _onDidOpenDataToolClientEmitter =
		this._register(new Emitter<DataToolClientInstance>);

	/**
	 * The onDidCloseDataToolClient event emitter.
	 */
	private readonly _onDidCloseDataToolClientEmitter =
		this._register(new Emitter<DataToolClientInstance>);

	//#endregion Private Properties

	/**
	 * The onDidOpenDataToolClient event.
	 */
	readonly onDidOpenDataToolClient = this._onDidOpenDataToolClientEmitter.event;

	/**
	 * The onDidCloseDataToolClient event.
	 */
	readonly onDidCloseDataToolClient = this._onDidCloseDataToolClientEmitter.event;

	//#region Constructor & Dispose

	/**
	 *
	 * @param runtime
	 */
	constructor(private readonly _runtime: ILanguageRuntime) {
		// Call the disposable constrcutor.
		super();

		/**
		 * Add the onDidCreateClientInstance event handler.
		 */
		this._register(this._runtime.onDidCreateClientInstance(async e => {
			// Ignore client types we don't process.
			if (e.client.getClientType() !== RuntimeClientType.DataTool) {
				return;
			}

			// Create and register the DataToolClientInstance for the client instance.
			const dataToolClientInstance = new DataToolClientInstance(e.client);
			this._register(dataToolClientInstance);

			// Add the onDidClose event handler on the DataToolClientInstance,
			dataToolClientInstance.onDidClose(() => {
				this._onDidCloseDataToolClientEmitter.fire(dataToolClientInstance);
			});

			// Test that we can get things.
			const foo = await dataToolClientInstance.getSchema();
			console.log(foo);
			const bar = await dataToolClientInstance.getDataValues(0, 10, [0, 1, 2, 3, 4, 5]);
			console.log(bar);

			// Raise the onDidOpenDataToolClient event.
			this._onDidOpenDataToolClientEmitter.fire(dataToolClientInstance);
		}));
	}

	//#endregion Constructor & Dispose
}

/**
 * PositronDataToolService class.
 */
class PositronDataToolService extends Disposable implements IPositronDataToolService {
	//#region Private Properties

	/**
	 * A map of the data tool runtimes keyed by runtime ID.
	 */
	private readonly _dataToolRuntimes = new Map<string, DataToolRuntime>();

	/**
	 * The Positron data tool instance map keyed by
	 */
	private _positronDataToolInstanceMap = new Map<string, PositronDataToolInstance>();

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _editorService The editor service.
	 * @param _languageRuntimeService The language runtime service.
	 */
	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService
	) {
		// Call the disposable constrcutor.
		super();

		// Add a data tool runtime for each running runtime.
		this._languageRuntimeService.runningRuntimes.forEach(runtime => {
			this.addDataToolRuntime(runtime);
		});

		// Register the onWillStartRuntime event handler.
		this._register(this._languageRuntimeService.onWillStartRuntime(runtime => {
			this.addDataToolRuntime(runtime);
		}));

		// Register the onDidStartRuntime event handler.
		this._register(this._languageRuntimeService.onDidStartRuntime(runtime => {
			// console.log(`++++++++++ PositronDataToolService: onDidStartRuntime ${runtime.metadata.runtimeId}`);
		}));

		// Register the onDidFailStartRuntime event handler.
		this._register(this._languageRuntimeService.onDidFailStartRuntime(runtime => {
			// console.log(`++++++++++ PositronDataToolService: onDidFailStartRuntime ${runtime.metadata.runtimeId}`);
		}));

		// Register the onDidReconnectRuntime event handler.
		this._register(this._languageRuntimeService.onDidReconnectRuntime(runtime => {
			// console.log(`++++++++++ PositronDataToolService: onDidReconnectRuntime ${runtime.metadata.runtimeId}`);
		}));

		// Register the onDidChangeRuntimeState event handler.
		this._register(this._languageRuntimeService.onDidChangeRuntimeState(stateEvent => {
			// console.log(`++++++++++ PositronDataToolService: onDidChangeRuntimeState from ${stateEvent.old_state} to ${stateEvent.new_state}`);
		}));
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// Dispose of the data tool runtimes.
		this._dataToolRuntimes.forEach(dataToolRuntime => {
			dataToolRuntime.dispose();
		});

		// Clear the data tool runtimes.
		this._dataToolRuntimes.clear();

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region IPositronDataToolService Implementation

	/**
	 * Needed for service branding in dependency injector.
	 */
	declare readonly _serviceBrand: undefined;

	/**
	 * Placeholder that gets called to "initialize" the PositronConsoleService.
	 */
	initialize() {
	}

	async open(dataToolClientInstance: DataToolClientInstance): Promise<void> {
		this._positronDataToolInstanceMap.set(
			dataToolClientInstance.identifier,
			new PositronDataToolInstance(dataToolClientInstance)
		);

		// Open the editor.
		await this._editorService.openEditor({
			resource: PositronDataToolUri.generate(dataToolClientInstance.identifier)
		});
	}

	/**
	 * Test open function.
	 */
	async testOpen(identifier: string): Promise<void> {
		// // Add the instance, if necessary.
		// if (!this._positronDataToolInstanceMap.has(identifier)) {
		// 	const positronDataToolInstance = new PositronDataToolInstance(identifier);
		// 	this._positronDataToolInstanceMap.set(identifier, positronDataToolInstance);
		// }

		// // Open the editor.
		// await this._editorService.openEditor({
		// 	resource: PositronDataToolUri.generate(identifier)
		// });
	}

	/**
	 * Gets a Positron data tool instance.
	 * @param identifier The identifier of the Positron data tool instance.
	 */
	getInstance(identifier: string): IPositronDataToolInstance | undefined {
		return this._positronDataToolInstanceMap.get(identifier);
	}

	//#endregion IPositronDataToolService Implementation

	//#region Private Methods

	/**
	 * Adds a data tool runtime.
	 * @param runtime
	 */
	private addDataToolRuntime(runtime: ILanguageRuntime) {
		// If the runtime has already been added, return.
		if (this._dataToolRuntimes.has(runtime.metadata.runtimeId)) {
			return;
		}

		// Create and add the data tool runtime.
		const dataToolRuntime = new DataToolRuntime(runtime);
		this._dataToolRuntimes.set(runtime.metadata.runtimeId, dataToolRuntime);

		dataToolRuntime.onDidOpenDataToolClient(dataToolClientInstance => {
			this.open(dataToolClientInstance);
		});

		dataToolRuntime.onDidCloseDataToolClient(dataToolClientInstance => {

		});
	}

	//#endregion Private Methods
}

// Register the Positron data tool service.
registerSingleton(IPositronDataToolService, PositronDataToolService, InstantiationType.Delayed);
