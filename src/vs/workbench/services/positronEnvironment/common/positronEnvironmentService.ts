/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronEnvironmentInstance } from 'vs/workbench/services/positronEnvironment/common/positronEnvironmentInstance';
import { IPositronEnvironmentService } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';
import { formatLanguageRuntime, ILanguageRuntime, ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronEnvironmentInstance, PositronEnvironmentInstanceState } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentInstance';

/**
 * PositronEnvironmentService class.
 */
class PositronEnvironmentService extends Disposable implements IPositronEnvironmentService {
	//#region Private Properties

	/**
	 * Gets a map of the Positron environment instances by language ID.
	 */
	private readonly _positronEnvironmentInstancesByLanguageId =
		new Map<string, PositronEnvironmentInstance>();

	/**
	 * Gets a map of the Positron environment instances by runtime ID.
	 */
	private readonly _positronEnvironmentInstancesByRuntimeId =
		new Map<string, PositronEnvironmentInstance>();

	/**
	 * Gets or sets the active Positron environment instance.
	 */
	private _activePositronEnvironmentInstance?: IPositronEnvironmentInstance;

	/**
	 * The onDidStartPositronEnvironmentInstance event emitter.
	 */
	private readonly _onDidStartPositronEnvironmentInstanceEmitter =
		this._register(new Emitter<IPositronEnvironmentInstance>);

	/**
	 * The onDidChangeActivePositronEnvironmentInstance event emitter.
	 */
	private readonly _onDidChangeActivePositronEnvironmentInstanceEmitter =
		this._register(new Emitter<IPositronEnvironmentInstance | undefined>);

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
	) {
		// Call the disposable constrcutor.
		super();

		// Start a Positron environment instance for each running runtime.
		this._languageRuntimeService.runningRuntimes.forEach(runtime => {
			this.startPositronEnvironmentInstance(runtime);
		});

		// Get the active runtime. If there is one, set the active Positron environment instance.
		if (this._languageRuntimeService.activeRuntime) {
			const positronEnvironmentInstance = this._positronEnvironmentInstancesByRuntimeId.get(
				this._languageRuntimeService.activeRuntime.metadata.runtimeId
			);
			if (positronEnvironmentInstance) {
				this.setActivePositronEnvironmentInstance(positronEnvironmentInstance);
			}
		}

		// Register the onWillStartRuntime event handler so we start a new Positron environment
		// instance before a runtime starts up.
		this._register(this._languageRuntimeService.onWillStartRuntime(runtime => {
			this.createOrAssignEnvironmentInstance(runtime);
		}));

		// Register the onDidStartRuntime event handler so we activate the new Positron environment
		// instance when the runtime starts up.
		this._register(this._languageRuntimeService.onDidStartRuntime(runtime => {
			const positronEnvironmentInstance = this._positronEnvironmentInstancesByRuntimeId.get(
				runtime.metadata.runtimeId
			);
			if (positronEnvironmentInstance) {
				positronEnvironmentInstance.setState(PositronEnvironmentInstanceState.Ready);
			}
		}));

		// Register the onDidFailStartRuntime event handler so we activate the new Positron
		// environment instance when the runtime starts up.
		this._register(this._languageRuntimeService.onDidFailStartRuntime(runtime => {
			const positronEnvironmentInstance = this._positronEnvironmentInstancesByRuntimeId.get(
				runtime.metadata.runtimeId
			);
			if (positronEnvironmentInstance) {
				positronEnvironmentInstance.setState(PositronEnvironmentInstanceState.Exited);
			}
		}));

		// Register the onDidReconnectRuntime event handler so we start a new Positron environment
		// instance when a runtime is reconnected.
		this._register(this._languageRuntimeService.onDidReconnectRuntime(runtime => {
			this.createOrAssignEnvironmentInstance(runtime);
		}));

		// Register the onDidChangeRuntimeState event handler so we can activate the REPL for the
		// active runtime.
		this._register(
			this._languageRuntimeService.onDidChangeRuntimeState(languageRuntimeStateEvent => {
				// Find the Positron environment instance.
				const positronEnvironmentInstance = this._positronEnvironmentInstancesByRuntimeId.get(
					languageRuntimeStateEvent.runtime_id
				);
				if (!positronEnvironmentInstance) {
					// TODO@softwarenerd... Handle this in some special way.
					return;
				}

				// Handle the state change.
				switch (languageRuntimeStateEvent.new_state) {
					case RuntimeState.Uninitialized:
					case RuntimeState.Initializing:
						break;

					case RuntimeState.Starting:
						positronEnvironmentInstance.setState(PositronEnvironmentInstanceState.Starting);
						break;

					case RuntimeState.Ready:
						positronEnvironmentInstance.setState(PositronEnvironmentInstanceState.Ready);
						break;

					case RuntimeState.Idle:
						positronEnvironmentInstance.setState(PositronEnvironmentInstanceState.Ready);
						break;

					case RuntimeState.Busy:
						positronEnvironmentInstance.setState(PositronEnvironmentInstanceState.Busy);
						break;

					case RuntimeState.Exiting:
						positronEnvironmentInstance.setState(PositronEnvironmentInstanceState.Exiting);
						break;

					case RuntimeState.Exited:
						positronEnvironmentInstance.setState(PositronEnvironmentInstanceState.Exited);
						break;

					case RuntimeState.Offline:
						positronEnvironmentInstance.setState(PositronEnvironmentInstanceState.Offline);
						break;

					case RuntimeState.Interrupting:
						break;
				}
			}));

		// Register the onDidChangeActiveRuntime event handler so we can activate the REPL for the
		// active runtime.
		this._register(this._languageRuntimeService.onDidChangeActiveRuntime(runtime => {
			if (!runtime) {
				this.setActivePositronEnvironmentInstance();
			} else {
				const positronEnvironmentInstance = this._positronEnvironmentInstancesByRuntimeId.get(
					runtime.metadata.runtimeId
				);
				if (positronEnvironmentInstance) {
					this.setActivePositronEnvironmentInstance(positronEnvironmentInstance);
				} else {
					this._logService.error(`Language runtime ${formatLanguageRuntime(runtime)} became active, but a REPL instance for it is not running.`);
				}
			}
		}));
	}

	//#endregion Constructor & Dispose

	//#region IPositronEnvironmentService Implementation

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	// An event that is fired when a REPL instance is started.
	readonly onDidStartPositronEnvironmentInstance =
		this._onDidStartPositronEnvironmentInstanceEmitter.event;

	// An event that is fired when the active REPL instance changes.
	readonly onDidChangeActivePositronEnvironmentInstance =
		this._onDidChangeActivePositronEnvironmentInstanceEmitter.event;

	// Gets the repl instances.
	get positronEnvironmentInstances(): IPositronEnvironmentInstance[] {
		return Array.from(this._positronEnvironmentInstancesByRuntimeId.values());
	}

	// Gets the active REPL instance.
	get activePositronEnvironmentInstance(): IPositronEnvironmentInstance | undefined {
		return this._activePositronEnvironmentInstance;
	}

	/**
	 * Placeholder that gets called to "initialize" the PositronEnvironmentService.
	 */
	initialize() {
	}

	//#endregion IPositronEnvironmentService Implementation

	//#region Private Methods

	/**
	 * Ensures that the given runtime has a corresponding Positron environment
	 * instance, either by attaching it to an existing Positron environment
	 * instance or by creating a new one. Has no effect if there's already a
	 * live Positron environment instance for the runtime.
	 *
	 * @param runtime The runtime to create or assign a Positron environment
	 * instance for.
	 */
	private createOrAssignEnvironmentInstance(runtime: ILanguageRuntime) {
		// Look for a matching Positron environment instance for this language.
		const positronEnvironmentInstance = this._positronEnvironmentInstancesByLanguageId.get(
			runtime.metadata.languageId
		);

		if (positronEnvironmentInstance) {

			const state = positronEnvironmentInstance.state;
			if (state !== PositronEnvironmentInstanceState.Uninitialized &&
				state !== PositronEnvironmentInstanceState.Exited &&
				positronEnvironmentInstance.runtime.metadata.runtimeId ===
				runtime.metadata.runtimeId) {
				// We already have a live Positron environment instance for this runtime, so
				// just return.
				return;
			}

			if (state === PositronEnvironmentInstanceState.Exited) {
				// The Positron environment instance has exited, so attach it to
				// this new runtime.
				positronEnvironmentInstance.setRuntime(runtime);
				this._positronEnvironmentInstancesByRuntimeId.delete(
					positronEnvironmentInstance.runtime.metadata.runtimeId
				);
				this._positronEnvironmentInstancesByRuntimeId.set(
					positronEnvironmentInstance.runtime.metadata.runtimeId,
					positronEnvironmentInstance
				);

				return;
			}
		}

		// If we got here, we need to start a new Positron environment instance.
		this.startPositronEnvironmentInstance(runtime);
	}

	/**
	 * Starts a Positron environment instance for the specified runtime.
	 * @param runtime The runtime for the new Positron environment instance.
	 * @returns The new Positron environment instance.
	 */
	private startPositronEnvironmentInstance(runtime: ILanguageRuntime): IPositronEnvironmentInstance {
		// Create the new Positron environment instance.
		const positronEnvironmentInstance = new PositronEnvironmentInstance(runtime, this._logService);

		// Add the Positron environment instance.
		this._positronEnvironmentInstancesByLanguageId.set(
			runtime.metadata.languageId,
			positronEnvironmentInstance
		);
		this._positronEnvironmentInstancesByRuntimeId.set(
			runtime.metadata.runtimeId,
			positronEnvironmentInstance
		);

		// Fire the onDidStartPositronEnvironmentInstance event.
		this._onDidStartPositronEnvironmentInstanceEmitter.fire(positronEnvironmentInstance);

		// Set the active positron environment instance.
		this._activePositronEnvironmentInstance = positronEnvironmentInstance;

		// Fire the onDidChangeActivePositronEnvironmentInstance event.
		this._onDidChangeActivePositronEnvironmentInstanceEmitter.fire(positronEnvironmentInstance);

		// Return the instance.
		return positronEnvironmentInstance;
	}

	/**
	 * Sets the active Positron environment instance.
	 * @param positronEnvironmentInstance
	 */
	private setActivePositronEnvironmentInstance(
		positronEnvironmentInstance?: IPositronEnvironmentInstance
	) {
		// Set the active instance and fire the onDidChangeActivePositronEnvironmentInstance event.
		this._activePositronEnvironmentInstance = positronEnvironmentInstance;
		this._onDidChangeActivePositronEnvironmentInstanceEmitter.fire(positronEnvironmentInstance);
	}

	//#endregion Private Methods
}

// Register the Positron environment service.
registerSingleton(
	IPositronEnvironmentService,
	PositronEnvironmentService,
	InstantiationType.Delayed
);
