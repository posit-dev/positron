/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { formatLanguageRuntime, ILanguageRuntime, ILanguageRuntimeGlobalEvent, ILanguageRuntimeService, ILanguageRuntimeStateEvent, LanguageRuntimeStartupBehavior, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * LanguageRuntimeInfo class.
 */
class LanguageRuntimeInfo {
	public state: RuntimeState;
	constructor(
		public readonly runtime: ILanguageRuntime,
		public readonly startupBehavior: LanguageRuntimeStartupBehavior) {
		this.state = runtime.getRuntimeState();
	}
	setState(state: RuntimeState): void {
		this.state = state;
	}
}

/**
 * The implementation of ILanguageRuntimeService
 */
export class LanguageRuntimeService extends Disposable implements ILanguageRuntimeService {
	//#region Private Properties

	// The set of encountered languages. This is keyed by the languageId and is
	// used to orchestrate implicit runtime startup.
	private readonly _encounteredLanguagesByLanguageId = new Set<string>();

	// The array of registered runtimes.
	private readonly _registeredRuntimes: LanguageRuntimeInfo[] = [];

	// A map of the registered runtimes. This is keyed by the runtimeId
	// (metadata.runtimeId) of the runtime.
	private readonly _registeredRuntimesByRuntimeId = new Map<string, LanguageRuntimeInfo>();

	// A map of the starting runtimes. This is keyed by the languageId
	// (metadata.languageId) of the runtime.
	private readonly _startingRuntimesByLanguageId = new Map<string, ILanguageRuntime>();

	// A map of the running runtimes. This is keyed by the languageId
	// (metadata.languageId) of the runtime.
	private readonly _runningRuntimesByLanguageId = new Map<string, ILanguageRuntime>();

	// The active runtime.
	private _activeRuntime?: ILanguageRuntime;

	// The event emitter for the onDidChangeRegisteredRuntimes event.
	private readonly _onDidChangeRegisteredRuntimesEmitter = this._register(new Emitter<void>);

	// The event emitter for the onWillStartRuntime event.
	private readonly _onWillStartRuntimeEmitter = this._register(new Emitter<ILanguageRuntime>);

	// The event emitter for the onDidStartRuntime event.
	private readonly _onDidStartRuntimeEmitter = this._register(new Emitter<ILanguageRuntime>);

	// The event emitter for the onDidFailStartRuntime event.
	private readonly _onDidFailStartRuntimeEmitter = this._register(new Emitter<ILanguageRuntime>);

	// The event emitter for the onDidReconnectRuntime event.
	private readonly _onDidReconnectRuntimeEmitter = this._register(new Emitter<ILanguageRuntime>);

	// The event emitter for the onDidChangeRuntimeState event.
	private readonly _onDidChangeRuntimeStateEmitter = this._register(new Emitter<ILanguageRuntimeStateEvent>());

	// The event emitter for the onDidReceiveRuntimeEvent event.
	private readonly _onDidReceiveRuntimeEventEmitter = this._register(new Emitter<ILanguageRuntimeGlobalEvent>());

	// The event emitter for the onDidChangeActiveRuntime event.
	private readonly _onDidChangeActiveRuntimeEmitter = this._register(new Emitter<ILanguageRuntime | undefined>);

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param _languageService The language service.
	 * @param _logService The log service.
	 */
	constructor(
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILogService private readonly _logService: ILogService
	) {
		// Call the base class's constructor.
		super();

		// Add the onDidEncounterLanguage event handler.
		this._register(this._languageService.onDidRequestRichLanguageFeatures(languageId => {
			// Add the language to the set of encountered languages.
			this._encounteredLanguagesByLanguageId.add(languageId);

			// If a runtime for the language is already starting or running,
			// there is no need to check for implicit startup below.
			if (this.runtimeForLanguageIsStartingOrRunning(languageId)) {
				return;
			}

			// Find the registered runtimes for the language that have implicit
			// startup behavior. If there aren't any, return.
			const languageRuntimeInfos = this._registeredRuntimes.filter(
				languageRuntimeInfo =>
					languageRuntimeInfo.runtime.metadata.languageId === languageId &&
					languageRuntimeInfo.startupBehavior === LanguageRuntimeStartupBehavior.Implicit);
			if (!languageRuntimeInfos.length) {
				return;
			}

			// Start the first runtime that was found. This isn't random; the
			// runtimes are sorted by priority when registered by the extension
			// so they will be in the right order so the first one is the right
			// one to start.
			this._logService.trace(`Language runtime ${formatLanguageRuntime(languageRuntimeInfos[0].runtime)} automatically starting`);
			this.doStartRuntime(languageRuntimeInfos[0].runtime);
		}));
	}

	//#endregion Constructor

	//#region ILanguageRuntimeService Implementation

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	// An event that fires when a runtime is about to start.
	readonly onDidChangeRegisteredRuntimes = this._onDidChangeRegisteredRuntimesEmitter.event;

	// An event that fires when a runtime is about to start.
	readonly onWillStartRuntime = this._onWillStartRuntimeEmitter.event;

	// An event that fires when a runtime successfully starts.
	readonly onDidStartRuntime = this._onDidStartRuntimeEmitter.event;

	// An event that fires when a runtime fails to start.
	readonly onDidFailStartRuntime = this._onDidFailStartRuntimeEmitter.event;

	// An event that fires when a runtime is reconnected.
	readonly onDidReconnectRuntime = this._onDidReconnectRuntimeEmitter.event;

	// An event that fires when a runtime changes state.
	readonly onDidChangeRuntimeState = this._onDidChangeRuntimeStateEmitter.event;

	// An event that fires when a runtime receives a global event.
	readonly onDidReceiveRuntimeEvent = this._onDidReceiveRuntimeEventEmitter.event;

	// An event that fires when the active runtime changes.
	readonly onDidChangeActiveRuntime = this._onDidChangeActiveRuntimeEmitter.event;

	/**
	 * Gets the registered runtimes.
	 */
	get registeredRuntimes(): ILanguageRuntime[] {
		return this._registeredRuntimes.map(_ => _.runtime);
	}

	/**
	 * Gets the running runtimes.
	 */
	get runningRuntimes(): ILanguageRuntime[] {
		return Array.from(this._runningRuntimesByLanguageId.values());
	}

	/**
	 * Gets the active runtime.
	 */
	get activeRuntime(): ILanguageRuntime | undefined {
		return this._activeRuntime;
	}

	/**
	 * Sets the active runtime.
	 */
	set activeRuntime(runtime: ILanguageRuntime | undefined) {
		// If there's nothing to do, return.
		if (!runtime && !this._activeRuntime) {
			return;
		}

		// Set the active runtime.
		if (!runtime) {
			this._activeRuntime = undefined;
		} else {
			// Sanity check that the runtime that was specified is registered.
			if (!this._registeredRuntimesByRuntimeId.has(runtime.metadata.runtimeId)) {
				this._logService.error(`Cannot activate language runtime ${formatLanguageRuntime(runtime)} because it is not registered.`);
				return;
			}

			// Find the runtime.
			const activeRuntime = this._startingRuntimesByLanguageId.get(runtime.metadata.languageId) || this._runningRuntimesByLanguageId.get(runtime.metadata.languageId);
			if (!activeRuntime) {
				this._logService.error(`Cannot activate language runtime ${formatLanguageRuntime(runtime)} because it is not running.`);
				return;
			}

			// Set the active runtime to the running runtime.
			this._activeRuntime = activeRuntime;
		}

		// Fire the onDidChangeActiveRuntime event.
		this._onDidChangeActiveRuntimeEmitter.fire(this._activeRuntime);
	}

	/**
	 * Register a new runtime
	 *
	 * @param runtime The runtime to register
	 * @returns A disposable that unregisters the runtime
	 */
	registerRuntime(runtime: ILanguageRuntime, startupBehavior: LanguageRuntimeStartupBehavior): IDisposable {
		console.log(`registerRuntime for ${runtime.metadata.languageName} ${runtime.metadata.languageVersion}`);
		// If the runtime has already been registered, throw an error.
		if (this._registeredRuntimesByRuntimeId.has(runtime.metadata.runtimeId)) {
			throw new Error(`Language runtime ${formatLanguageRuntime(runtime)} has already been registered.`);
		}

		// Add the runtime to the registered runtimes.
		const languageRuntimeInfo = new LanguageRuntimeInfo(runtime, startupBehavior);
		this._registeredRuntimes.push(languageRuntimeInfo);
		this._registeredRuntimesByRuntimeId.set(runtime.metadata.runtimeId, languageRuntimeInfo);

		// Signal that the set of registered runtimes has changed.
		this._onDidChangeRegisteredRuntimesEmitter.fire();

		// Runtimes are usually registered in the Uninitialized state. If the
		// runtime is already running when it is registered, we are
		// reconnecting to it, so we need to add it to the running runtimes.
		if (runtime.getRuntimeState() !== RuntimeState.Uninitialized &&
			runtime.getRuntimeState() !== RuntimeState.Exited) {
			// Add the runtime to the running runtimes.
			this._runningRuntimesByLanguageId.set(runtime.metadata.languageId, runtime);

			// Signal that the runtime has been reconnected.
			this._onDidReconnectRuntimeEmitter.fire(runtime);

			// If we have no active runtime, set the active runtime to the new runtime, since it's
			// already active.
			if (!this._activeRuntime) {
				this.activeRuntime = runtime;
			}
		}

		// Logging.
		this._logService.trace(`Language runtime ${formatLanguageRuntime(runtime)} successfully registered.`);

		// If the language has already been encountered, and a runtime for it
		// it isn't already starting or running, and it allows for implicit
		// startup, start it.
		if (this._encounteredLanguagesByLanguageId.has(runtime.metadata.languageId) &&
			!this.runtimeForLanguageIsStartingOrRunning(runtime.metadata.languageId) &&
			startupBehavior === LanguageRuntimeStartupBehavior.Implicit) {
			this._logService.trace(`Language runtime ${formatLanguageRuntime(runtime)} automatically starting.`);
			this.doStartRuntime(languageRuntimeInfo.runtime);
		}

		// Add the onDidChangeRuntimeState event handler.
		this._register(runtime.onDidChangeRuntimeState(state => {
			// Process the state change.
			switch (state) {
				case RuntimeState.Starting:
					// Typically, the runtime starts when we ask it to (in `doStartRuntime`), but
					// if the runtime is already running when it is registered, we are reconnecting.
					// In that case, we need to add it to the running runtimes and signal that the
					// runtime has reconnected.
					if (!this.runtimeForLanguageIsStartingOrRunning(runtime.metadata.languageId)) {
						// Add the runtime to the running runtimes.
						this._runningRuntimesByLanguageId.set(runtime.metadata.languageId, runtime);

						// Signal that the runtime has been reconnected.
						this._onDidReconnectRuntimeEmitter.fire(runtime);
					}
					break;

				case RuntimeState.Ready:
					// If the runtime is ready, and we have no active runtime,
					// set the active runtime to the new runtime.
					if (!this._activeRuntime || this._activeRuntime.metadata.languageId === runtime.metadata.languageId) {
						this.activeRuntime = runtime;
					}
					break;

				case RuntimeState.Exited:
					// Remove the runtime from the set of starting or running runtimes.
					this._startingRuntimesByLanguageId.delete(runtime.metadata.languageId);
					this._runningRuntimesByLanguageId.delete(runtime.metadata.languageId);
					break;
			}

			// Let listeners know that the runtime state has changed.
			const languageRuntimeInfo = this._registeredRuntimesByRuntimeId.get(runtime.metadata.runtimeId);
			if (!languageRuntimeInfo) {
				this._logService.error(`Language runtime ${formatLanguageRuntime(runtime)} is not registered.`);
			} else {
				const oldState = languageRuntimeInfo.state;
				languageRuntimeInfo.setState(state);
				this._onDidChangeRuntimeStateEmitter.fire({
					runtime_id: runtime.metadata.runtimeId,
					old_state: oldState,
					new_state: state
				});
				// If the runtime is restarting and has just exited, let Positron know that it's
				// about to start again. Note that we need to do this on the next tick since we
				// need to ensure all the event handlers for the state change we
				// are currently processing have been called (i.e. everyone knows it has exited)
				setTimeout(() => {
					if (oldState === RuntimeState.Restarting &&
						state === RuntimeState.Exited) {
						this._onWillStartRuntimeEmitter.fire(runtime);
					}
				}, 0);
			}
		}));

		// Add the onDidReceiveRuntimeMessageEvent event handler.
		this._register(runtime.onDidReceiveRuntimeMessageEvent(languageRuntimeMessageEvent => {
			// Rebroadcast runtime events globally
			this._onDidReceiveRuntimeEventEmitter.fire({
				runtime_id: runtime.metadata.runtimeId,
				event: languageRuntimeMessageEvent
			});
		}));

		return toDisposable(() => {
			// Remove the runtime from the set of starting or running runtimes.
			this._startingRuntimesByLanguageId.delete(runtime.metadata.languageId);
			this._runningRuntimesByLanguageId.delete(runtime.metadata.languageId);
		});
	}

	/**
	 * Returns a specific runtime by runtime identifier.
	 * @param runtimeId The runtime identifier of the runtime to retrieve.
	 * @returns The runtime with the given runtime identifier, or undefined if
	 * no runtime with the given runtime identifier exists.
	 */
	getRuntime(runtimeId: string): ILanguageRuntime | undefined {
		return this._registeredRuntimesByRuntimeId.get(runtimeId)?.runtime;
	}

	/**
	 * Starts a runtime.
	 * @param runtimeId The runtime identifier of the runtime to start.
	 */
	startRuntime(runtimeId: string): void {
		// Get the runtime. Throw an error, if it could not be found.
		const languageRuntimeInfo = this._registeredRuntimesByRuntimeId.get(runtimeId);
		if (!languageRuntimeInfo) {
			throw new Error(`No language runtime with id '${runtimeId}' was found.`);
		}

		// If there is already a runtime running for the language, throw an error.
		const startingLanguageRuntime = this._startingRuntimesByLanguageId.get(languageRuntimeInfo.runtime.metadata.languageId);
		if (startingLanguageRuntime) {
			throw new Error(`Language runtime ${formatLanguageRuntime(languageRuntimeInfo.runtime)} cannot be started because language runtime ${formatLanguageRuntime(startingLanguageRuntime)} is already starting for the language.`);
		}

		// If there is already a runtime running for the language, throw an error.
		const runningLanguageRuntime = this._runningRuntimesByLanguageId.get(languageRuntimeInfo.runtime.metadata.languageId);
		if (runningLanguageRuntime) {
			throw new Error(`Language runtime ${formatLanguageRuntime(languageRuntimeInfo.runtime)} cannot be started because language runtime ${formatLanguageRuntime(runningLanguageRuntime)} is already running for the language.`);
		}

		// Start the runtime.
		this.doStartRuntime(languageRuntimeInfo.runtime);
	}

	//#endregion ILanguageRuntimeService Implementation

	//#region Private Methods

	/**
	 * Checks to see whether a runtime for the specified language is starting
	 * or running.
	 * @param languageId The language identifier.
	 * @returns A value which indicates whether a runtime for the specified
	 * language is starting or running.
	 */
	private runtimeForLanguageIsStartingOrRunning(languageId: string) {
		return this._startingRuntimesByLanguageId.has(languageId) ||
			this._runningRuntimesByLanguageId.has(languageId);
	}

	/**
	 * Starts a runtime.
	 * @param runtime The runtime to start.
	 */
	private doStartRuntime(runtime: ILanguageRuntime): void {
		// Add the runtime to the starting runtimes.
		this._startingRuntimesByLanguageId.set(runtime.metadata.languageId, runtime);

		// Fire the onWillStartRuntime event.
		this._onWillStartRuntimeEmitter.fire(runtime);

		// Attempt to start the runtime.
		runtime.start().then(_languageRuntimeInfo => {
			// The runtime started. Move it from the starting runtimes to the
			// running runtimes.
			this._startingRuntimesByLanguageId.delete(runtime.metadata.languageId);
			this._runningRuntimesByLanguageId.set(runtime.metadata.languageId, runtime);

			// Fire the onDidStartRuntime event.
			this._onDidStartRuntimeEmitter.fire(runtime);

			// Make the newly-started runtime the active runtime.
			this.activeRuntime = runtime;
		}, (reason) => {
			// Remove the runtime from the starting runtimes.
			this._startingRuntimesByLanguageId.delete(runtime.metadata.languageId);

			// Fire the onDidFailStartRuntime event.
			this._onDidFailStartRuntimeEmitter.fire(runtime);

			// TODO@softwarenerd - We should do something with the reason.
			this._logService.error(`Starting language runtime failed. Reason: ${reason}`);
		});
	}

	//#region Private Methods
}

// Instantiate the language runtime service "eagerly", meaning as soon as a
// consumer depdends on it. This fixes an issue where languages are encountered
// BEFORE the language runtime service has been instantiated.
registerSingleton(ILanguageRuntimeService, LanguageRuntimeService, InstantiationType.Eager);
