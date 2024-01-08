/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronVariablesInstance } from 'vs/workbench/services/positronVariables/common/positronVariablesInstance';
import { IPositronVariablesService } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesService';
import { IPositronVariablesInstance, PositronVariablesInstanceState } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesInstance';
import { formatLanguageRuntime, ILanguageRuntime, ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { INotificationService } from 'vs/platform/notification/common/notification';

/**
 * PositronVariablesService class.
 */
class PositronVariablesService extends Disposable implements IPositronVariablesService {
	//#region Private Properties

	/**
	 * Gets a map of the Positron variables instances by language ID.
	 */
	private readonly _positronVariablesInstancesByLanguageId =
		new Map<string, PositronVariablesInstance>();

	/**
	 * Gets a map of the Positron variables instances by runtime ID.
	 */
	private readonly _positronVariablesInstancesByRuntimeId =
		new Map<string, PositronVariablesInstance>();

	/**
	 * Gets or sets the active Positron variables instance.
	 */
	private _activePositronVariablesInstance?: IPositronVariablesInstance;

	/**
	 * The onDidStartPositronVariablesInstance event emitter.
	 */
	private readonly _onDidStartPositronVariablesInstanceEmitter =
		this._register(new Emitter<IPositronVariablesInstance>);

	/**
	 * The onDidChangeActivePositronVariablesInstance event emitter.
	 */
	private readonly _onDidChangeActivePositronVariablesInstanceEmitter =
		this._register(new Emitter<IPositronVariablesInstance | undefined>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _languageRuntimeService The language runtime service.
	 * @param _languageService The language service.
	 * @param _logService The log service.
	 */
	constructor(
		@ILanguageRuntimeService private _languageRuntimeService: ILanguageRuntimeService,
		@ILanguageService _languageService: ILanguageService,
		@ILogService private _logService: ILogService,
		@INotificationService private _notificationService: INotificationService
	) {
		// Call the disposable constrcutor.
		super();

		// Start a Positron variables instance for each running runtime.
		this._languageRuntimeService.runningRuntimes.forEach(runtime => {
			this.startPositronVariablesInstance(runtime);
		});

		// Get the active runtime. If there is one, set the active Positron variables instance.
		if (this._languageRuntimeService.activeRuntime) {
			const positronVariablesInstance = this._positronVariablesInstancesByRuntimeId.get(
				this._languageRuntimeService.activeRuntime.metadata.runtimeId
			);
			if (positronVariablesInstance) {
				this.setActivePositronVariablesInstance(positronVariablesInstance);
			}
		}

		// Register the onWillStartRuntime event handler so we start a new Positron variables
		// instance before a runtime starts up.
		this._register(this._languageRuntimeService.onWillStartRuntime(runtime => {
			this.createOrAssignPositronVariablesInstance(runtime);
		}));

		// Register the onDidStartRuntime event handler so we activate the new Positron variables
		// instance when the runtime starts up.
		this._register(this._languageRuntimeService.onDidStartRuntime(runtime => {
			const positronVariablesInstance = this._positronVariablesInstancesByRuntimeId.get(
				runtime.metadata.runtimeId
			);
			if (positronVariablesInstance) {
				positronVariablesInstance.setState(PositronVariablesInstanceState.Ready);
			}
		}));

		// Register the onDidFailStartRuntime event handler.
		this._register(this._languageRuntimeService.onDidFailStartRuntime(runtime => {
			const positronVariablesInstance = this._positronVariablesInstancesByRuntimeId.get(
				runtime.metadata.runtimeId
			);
			if (positronVariablesInstance) {
				positronVariablesInstance.setState(PositronVariablesInstanceState.Exited);
			}
		}));

		// Register the onDidReconnectRuntime event handler.
		this._register(this._languageRuntimeService.onDidReconnectRuntime(runtime => {
			this.createOrAssignPositronVariablesInstance(runtime);
		}));

		// Register the onDidChangeRuntimeState event handler.
		this._register(
			this._languageRuntimeService.onDidChangeRuntimeState(languageRuntimeStateEvent => {
				// Find the Positron variables instance.
				const positronVariablesInstance = this._positronVariablesInstancesByRuntimeId.get(
					languageRuntimeStateEvent.runtime_id
				);
				if (!positronVariablesInstance) {
					// TODO@softwarenerd... Handle this in some special way.
					return;
				}

				// Handle the state change.
				switch (languageRuntimeStateEvent.new_state) {
					case RuntimeState.Uninitialized:
					case RuntimeState.Initializing:
						break;

					case RuntimeState.Starting:
						positronVariablesInstance.setState(PositronVariablesInstanceState.Starting);
						break;

					case RuntimeState.Ready:
						positronVariablesInstance.setState(PositronVariablesInstanceState.Ready);
						break;

					case RuntimeState.Idle:
						positronVariablesInstance.setState(PositronVariablesInstanceState.Ready);
						break;

					case RuntimeState.Busy:
						positronVariablesInstance.setState(PositronVariablesInstanceState.Busy);
						break;

					case RuntimeState.Exiting:
						positronVariablesInstance.setState(PositronVariablesInstanceState.Exiting);
						break;

					case RuntimeState.Exited:
						positronVariablesInstance.setState(PositronVariablesInstanceState.Exited);
						break;

					case RuntimeState.Offline:
						positronVariablesInstance.setState(PositronVariablesInstanceState.Offline);
						break;

					case RuntimeState.Interrupting:
						break;
				}
			}));

		// Register the onDidChangeActiveRuntime event handler.
		this._register(this._languageRuntimeService.onDidChangeActiveRuntime(runtime => {
			if (!runtime) {
				this.setActivePositronVariablesInstance();
			} else {
				const positronVariablesInstance = this._positronVariablesInstancesByRuntimeId.get(
					runtime.metadata.runtimeId
				);
				if (positronVariablesInstance) {
					this.setActivePositronVariablesInstance(positronVariablesInstance);
				} else {
					this._logService.error(`Language runtime ${formatLanguageRuntime(runtime)} became active, but a REPL instance for it is not running.`);
				}
			}
		}));
	}

	//#endregion Constructor & Dispose

	//#region IPositronVariablesService Implementation

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	// An event that is fired when a REPL instance is started.
	readonly onDidStartPositronVariablesInstance =
		this._onDidStartPositronVariablesInstanceEmitter.event;

	// An event that is fired when the active REPL instance changes.
	readonly onDidChangeActivePositronVariablesInstance =
		this._onDidChangeActivePositronVariablesInstanceEmitter.event;

	// Gets the repl instances.
	get positronVariablesInstances(): IPositronVariablesInstance[] {
		return Array.from(this._positronVariablesInstancesByRuntimeId.values());
	}

	// Gets the active REPL instance.
	get activePositronVariablesInstance(): IPositronVariablesInstance | undefined {
		return this._activePositronVariablesInstance;
	}

	/**
	 * Placeholder that gets called to "initialize" the PositronVariablesService.
	 */
	initialize() {
	}

	//#endregion IPositronVariablesService Implementation

	//#region Private Methods

	/**
	 * Ensures that the given runtime has a corresponding Positron variables instance, either by
	 * attaching it to an existing Positron variables instance or by creating a new one. Has no
	 * effect if there's already a live Positron variables instance for the runtime.
	 * @param runtime The runtime to create or assign a Positron variables instance for.
	 */
	private createOrAssignPositronVariablesInstance(runtime: ILanguageRuntime) {
		// Look for a matching Positron variables instance for this language.
		const positronVariablesInstance = this._positronVariablesInstancesByLanguageId.get(
			runtime.metadata.languageId
		);

		if (positronVariablesInstance) {

			const state = positronVariablesInstance.state;
			if (state !== PositronVariablesInstanceState.Uninitialized &&
				state !== PositronVariablesInstanceState.Exited &&
				positronVariablesInstance.runtime.metadata.runtimeId ===
				runtime.metadata.runtimeId) {
				// We already have a live Positron variables instance for this runtime, so just
				// return.
				return;
			}

			if (state === PositronVariablesInstanceState.Exited) {
				// The Positron variables instance has exited, so attach it to this new runtime.
				positronVariablesInstance.setRuntime(runtime);
				this._positronVariablesInstancesByRuntimeId.delete(
					positronVariablesInstance.runtime.metadata.runtimeId
				);
				this._positronVariablesInstancesByRuntimeId.set(
					positronVariablesInstance.runtime.metadata.runtimeId,
					positronVariablesInstance
				);

				return;
			}
		}

		// If we got here, we need to start a new Positron variables instance.
		this.startPositronVariablesInstance(runtime);
	}

	/**
	 * Starts a Positron variables instance for the specified runtime.
	 * @param runtime The runtime for the new Positron variables instance.
	 * @returns The new Positron variables instance.
	 */
	private startPositronVariablesInstance(runtime: ILanguageRuntime): IPositronVariablesInstance {
		// Create the new Positron variables instance.
		const positronVariablesInstance = new PositronVariablesInstance(
			runtime, this._logService, this._notificationService);

		// Add the Positron variables instance.
		this._positronVariablesInstancesByLanguageId.set(
			runtime.metadata.languageId,
			positronVariablesInstance
		);
		this._positronVariablesInstancesByRuntimeId.set(
			runtime.metadata.runtimeId,
			positronVariablesInstance
		);

		// Fire the onDidStartPositronVariablesInstance event.
		this._onDidStartPositronVariablesInstanceEmitter.fire(positronVariablesInstance);

		// Set the active Positron variables instance.
		this._activePositronVariablesInstance = positronVariablesInstance;

		// Fire the onDidChangeActivePositronVariablesInstance event.
		this._onDidChangeActivePositronVariablesInstanceEmitter.fire(positronVariablesInstance);

		// Return the instance.
		return positronVariablesInstance;
	}

	/**
	 * Sets the active Positron variables instance.
	 * @param positronVariablesInstance The Positron variables instance.
	 */
	private setActivePositronVariablesInstance(
		positronVariablesInstance?: IPositronVariablesInstance
	) {
		// Set the active instance and fire the onDidChangeActivePositronVariablesInstance event.
		this._activePositronVariablesInstance = positronVariablesInstance;
		this._onDidChangeActivePositronVariablesInstanceEmitter.fire(positronVariablesInstance);
	}

	//#endregion Private Methods
}

// Register the Positron variables service.
registerSingleton(IPositronVariablesService, PositronVariablesService, InstantiationType.Delayed);
