/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { PositronDataExplorerFocused } from 'vs/workbench/common/contextkeys';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronDataExplorerUri } from 'vs/workbench/services/positronDataExplorer/common/positronDataExplorerUri';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { PositronDataExplorerInstance } from 'vs/workbench/services/positronDataExplorer/browser/positronDataExplorerInstance';
import { ILanguageRuntimeSession, IRuntimeSessionService, RuntimeClientType } from '../../runtimeSession/common/runtimeSessionService';
import { IPositronDataExplorerService } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';
import { IPositronDataExplorerInstance } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance';

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
	 * @param _session The session.
	 * @param _notificationService The notification service.
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
	 * Gets or sets the PositronDataExplorerFocused context key.
	 */
	private _positronDataExplorerFocusedContextKey: IContextKey<boolean>;

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
	 * The focused Positron data explorer identifier.
	 */
	private _focusedPositronDataExplorerIdentifier?: string;

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _clipboardService The clipboard service.
	 * @param _contextKeyService The context key service.
	 * @param _commandService The command service.
	 * @param _configurationService The configuration service.
	 * @param _editorService The editor service.
	 * @param _hoverService The hover service.
	 * @param _keybindingService The keybinding service.
	 * @param _layoutService The layout service.
	 * @param _notificationService The notification service.
	 * @param _runtimeSessionService The language runtime session service.
	 */
	constructor(
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEditorService private readonly _editorService: IEditorService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@ILayoutService private readonly _layoutService: ILayoutService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService
	) {
		// Call the disposable constrcutor.
		super();

		// Bind the PositronDataExplorerFocused context key.
		this._positronDataExplorerFocusedContextKey = PositronDataExplorerFocused.bindTo(
			this._contextKeyService
		);

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

	/**
	 * Sets the focused Positron data explorer.
	 * @param identifier The identifier of the focused Positron data explorer to set.
	 */
	setFocusedPositronDataExplorer(identifier: string) {
		if (this._focusedPositronDataExplorerIdentifier !== identifier) {
			this._focusedPositronDataExplorerIdentifier = identifier;
			this._positronDataExplorerFocusedContextKey.set(true);
		}
	}

	/**
	 * Clears the focused Positron data explorer.
	 * @param identifier The identifier of the focused Positron data explorer to clear.
	 */
	clearFocusedPositronDataExplorer(identifier: string) {
		if (this._focusedPositronDataExplorerIdentifier === identifier) {
			this._focusedPositronDataExplorerIdentifier = undefined;
			this._positronDataExplorerFocusedContextKey.set(false);
		}
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

	//#endregion IPositronDataExplorerService Implementation

	//#region Private Methods

	/**
	 * Adds a data explorer runtime.
	 *
	 * @param session The runtime session.
	 */
	private addDataExplorerSession(session: ILanguageRuntimeSession) {
		// If the runtime has already been added, return.
		if (this._dataExplorerRuntimes.has(session.sessionId)) {
			return;
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

		// Set the Positron data explorer client instance.
		this._positronDataExplorerInstances.set(
			dataExplorerClientInstance.identifier,
			new PositronDataExplorerInstance(
				this._clipboardService,
				this._commandService,
				this._configurationService,
				this._hoverService,
				this._keybindingService,
				this._layoutService,
				this._notificationService,
				languageName,
				dataExplorerClientInstance
			)
		);

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

		// Hack to be able to call PositronDataExplorerEditorInput.setName without eslint errors.
		this._register(dataExplorerClientInstance.onDidUpdateBackendState(backendState => {
			const dxInput = editorPane?.input as any;
			if (dxInput !== undefined && backendState.display_name !== undefined) {
				dxInput.setName?.(`Data: ${backendState.display_name}`);
			}
		}));

		this._register(dataExplorerClientInstance.onDidClose(() => {
			// When the data explorer client instance is closed, clean up
			// references to variables. We may still need to keep the instance
			// map since the defunct instances may still be bound to open
			// editors.
			for (const [key, value] of this._varIdToInstanceIdMap.entries()) {
				if (value === dataExplorerClientInstance.identifier) {
					this._varIdToInstanceIdMap.delete(key);
				}
			}
		}));

		// Trigger the initial state update.
		await dataExplorerClientInstance.updateBackendState();
	}

	/**
	 * Closes the editor for the specified DataExplorerClientInstance.
	 * @param dataExplorerClientInstance The DataExplorerClientInstance for the editor.
	 */
	private closeEditor(dataExplorerClientInstance: DataExplorerClientInstance) {
		// Get the Positron data explorer client instance.
		const positronDataExplorerInstance = this._positronDataExplorerInstances.get(
			dataExplorerClientInstance.identifier
		);

		// If there isn't a Positron data explorer client instance, return.
		if (!positronDataExplorerInstance) {
			return;
		}

		// Delete the Positron data explorer client instance.
		this._positronDataExplorerInstances.delete(dataExplorerClientInstance.identifier);
	}

	//#endregion Private Methods
}

// Register the Positron data explorer service.
registerSingleton(
	IPositronDataExplorerService,
	PositronDataExplorerService,
	InstantiationType.Delayed
);
