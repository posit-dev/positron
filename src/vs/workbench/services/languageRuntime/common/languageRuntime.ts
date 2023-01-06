/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { formatLanguageRuntime, ILanguageRuntime, ILanguageRuntimeEvent, ILanguageRuntimeGlobalEvent, ILanguageRuntimeService, ILanguageRuntimeStateEvent, LanguageRuntimeMessageType, LanguageRuntimeStartupBehavior, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * The language runtime info class.
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

	// The set of encountered languages. This is used to orchestrate implicit runtime startup.
	private readonly _encounteredLanguages = new Set<string>();

	// The array of registered language runtimes.
	private readonly _registeredLanguageRuntimes = new Array<LanguageRuntimeInfo>();

	// A map of the registered language runtimes. This is keyed by the id (metadata.id) of the language runtime.
	private readonly _registeredLanguageRuntimesMap = new Map<string, LanguageRuntimeInfo>();

	// A map of the running language runtimes. This is keyed by the language (metadata.language) of the language runtime.
	private readonly _runningLanguageRuntimesMap = new Map<string, ILanguageRuntime>();

	// The active runtime.
	private _activeRuntime?: ILanguageRuntime;

	// The event emitter for the onDidStartRuntime event.
	private readonly _onDidStartRuntime = this._register(new Emitter<ILanguageRuntime>);

	// The event emitter for the onDidChangeRuntimeState event.
	private readonly _onDidChangeRuntimeState = this._register(new Emitter<ILanguageRuntimeStateEvent>());

	// The event emitter for the onDidReceiveRuntimeEvent event.
	private readonly _onDidReceiveRuntimeEvent = this._register(new Emitter<ILanguageRuntimeGlobalEvent>());

	// The event emitter for the onDidChangeActiveRuntime event.
	private readonly _onDidChangeActiveRuntime = this._register(new Emitter<ILanguageRuntime | undefined>);

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param _commandService The command service.
	 * @param _languageService The language service.
	 * @param _logService The log service.
	 */
	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILogService private readonly _logService: ILogService
	) {
		super();
		this._register(this._languageService.onDidEncounterLanguage(language => {
			// Add the language to the set of encountered languages.
			this._encounteredLanguages.add(language);

			// If a language runtime for the language is already running, return.
			if (this._runningLanguageRuntimesMap.has(language)) {
				return;
			}

			// Find the registered language runtimes for the language that have implicit startup behavior. If there aren't any,
			// return.
			const languageRuntimeInfos = this._registeredLanguageRuntimes.filter(
				_ => _.runtime.metadata.language === language && _.startupBehavior === LanguageRuntimeStartupBehavior.Implicit);
			if (!languageRuntimeInfos.length) {
				return;
			}

			// Start the first language runtime that was found. This isn't random; the runtimes are sorted by priority when
			// registered by the extension, so they will be in the right order so the first one is the right one to start.
			this._logService.trace(`Language runtime ${formatLanguageRuntime(languageRuntimeInfos[0].runtime)} automatically starting`);
			this.safeStartRuntime(languageRuntimeInfos[0].runtime);
		}));
	}

	//#endregion Constructor

	//#region ILanguageRuntimeService Implementation

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	// An event that fires when a runtime starts.
	readonly onDidStartRuntime = this._onDidStartRuntime.event;

	// An event that fires when a runtime changes state.
	readonly onDidChangeRuntimeState = this._onDidChangeRuntimeState.event;

	// An event that fires when a runtime receives a global event.
	readonly onDidReceiveRuntimeEvent = this._onDidReceiveRuntimeEvent.event;

	// An event that fires when a runtime starts.
	readonly onDidChangeActiveRuntime = this._onDidChangeActiveRuntime.event;

	/**
	 * Gets the registered language runtimes.
	 */
	get registeredRuntimes(): ILanguageRuntime[] {
		return this._registeredLanguageRuntimes.map(_ => _.runtime);
	}

	/**
	 * Gets the running language runtime.
	 */
	get runningRuntimes(): ILanguageRuntime[] {
		return Array.from(this._runningLanguageRuntimesMap.values());
	}

	/**
	 * Gets the active language runtime.
	 */
	get activeRuntime(): ILanguageRuntime | undefined {
		return this._activeRuntime;
	}

	/**
	 * Sets the active language runtime.
	 */
	set activeRuntime(runtime: ILanguageRuntime | undefined) {
		// If the language runtime is already active, return.
		if (this._activeRuntime === runtime) {
			return;
		}

		// Set the active language runtime.
		if (!runtime) {
			this._activeRuntime = runtime;
		} else {
			// Sanity check that the language runtime that was specified is registered.
			if (!this._registeredLanguageRuntimesMap.has(runtime.metadata.id)) {
				this._logService.error(`Cannot activate language runtime ${formatLanguageRuntime(runtime)} because it is not registered.`);
				return;
			}

			// Sanity check that the language runtime that was specified is running.
			const runningRuntime = this._runningLanguageRuntimesMap.get(runtime.metadata.language);
			if (!runningRuntime || runningRuntime.metadata.id !== runtime.metadata.id) {
				this._logService.error(`Cannot activate language runtime ${formatLanguageRuntime(runtime)} because it is not running.`);
				return;
			}

			// Set the active language runtime to the running language runtime.
			this._activeRuntime = runningRuntime;
		}

		// Fire the onDidChangeActiveRuntime event.
		this._onDidChangeActiveRuntime.fire(this._activeRuntime);
	}

	/**
	 * Register a new language runtime
	 *
	 * @param runtime The runtime to register
	 * @returns A disposable that unregisters the runtime
	 */
	registerRuntime(runtime: ILanguageRuntime, startupBehavior: LanguageRuntimeStartupBehavior): IDisposable {
		// If the language runtime has already been registered, throw an error.
		if (this._registeredLanguageRuntimesMap.has(runtime.metadata.id)) {
			throw new Error(`Language runtime ${formatLanguageRuntime(runtime)} has already been registered.`);
		}

		// Add the language runtime to the registered language runtimes.
		const languageRuntimeInfo = new LanguageRuntimeInfo(runtime, startupBehavior);
		this._registeredLanguageRuntimes.push(languageRuntimeInfo);
		this._registeredLanguageRuntimesMap.set(runtime.metadata.id, languageRuntimeInfo);

		// Logging.
		this._logService.trace(`Language runtime ${formatLanguageRuntime(runtime)} successfully registered.`);

		// If the language has already been encountered, and it isn't already running, and it allows
		// for implicit startup, start it.
		if (this._encounteredLanguages.has(runtime.metadata.language) &&
			!this._runningLanguageRuntimesMap.has(runtime.metadata.language) &&
			startupBehavior === LanguageRuntimeStartupBehavior.Implicit) {
			this._logService.trace(`Language runtime ${formatLanguageRuntime(runtime)} automatically starting.`);
			this.safeStartRuntime(languageRuntimeInfo.runtime);
		}

		this._register(runtime.onDidChangeRuntimeState(state => {
			// If the state is exited, remove the language runtime from the set of running language runtimes.
			if (state === RuntimeState.Exited) {
				this._runningLanguageRuntimesMap.delete(runtime.metadata.language);
			}

			// Let listeners know that the runtime state has changed.
			const languageRuntimeInfo = this._registeredLanguageRuntimesMap.get(runtime.metadata.id);
			if (!languageRuntimeInfo) {
				this._logService.error(`Language runtime ${formatLanguageRuntime(runtime)} is not registered.`);
			} else {
				const oldState = languageRuntimeInfo.state;
				languageRuntimeInfo.setState(state);
				this._onDidChangeRuntimeState.fire({
					id: runtime.metadata.id,
					old_state: oldState,
					new_state: state
				});
			}
		}));

		this._register(runtime.onDidReceiveRuntimeMessage((message) => {
			// Rebroadcast runtime events globally
			if (message.type === LanguageRuntimeMessageType.Event) {
				const event = message as ILanguageRuntimeEvent;
				this._onDidReceiveRuntimeEvent.fire({
					id: runtime.metadata.id,
					event
				});
			}
		}));

		return toDisposable(() => {
			this._runningLanguageRuntimesMap.delete(runtime.metadata.language);
		});
	}

	/**
	 * Returns a specific runtime by ID
	 *
	 * @param id The ID of the runtime to retrieve
	 * @returns The runtime with the given ID, or undefined if no runtime with
	 * the given ID exists
	 */
	getRuntime(id: string): ILanguageRuntime | undefined {
		return this._registeredLanguageRuntimesMap.get(id)?.runtime;
	}

	/**
	 * Starts a language runtime
	 * @param id The id of the runtime to start
	 */
	startRuntime(id: string): void {
		// Get the language runtime. Throw an error, if it could not be found.
		const languageRuntimeInfo = this._registeredLanguageRuntimesMap.get(id);
		if (!languageRuntimeInfo) {
			throw new Error(`No language runtime with id '${id}' was found.`);
		}

		// If there is already a language runtime running for the language, throw an error.
		const runningLanguageRuntime = this._runningLanguageRuntimesMap.get(languageRuntimeInfo.runtime.metadata.language);
		if (runningLanguageRuntime) {
			throw new Error(`Language runtime ${formatLanguageRuntime(languageRuntimeInfo.runtime)} cannot be started because language runtime ${formatLanguageRuntime(runningLanguageRuntime)} is already running for the language.`);
		}

		// Start the language runtime.
		this.safeStartRuntime(languageRuntimeInfo.runtime);
	}

	//#endregion ILanguageRuntimeService Implementation

	//#region Private Methods

	/**
	 * Starts a language runtime.
	 * @param runtime The language runtime to start.
	 */
	private safeStartRuntime(runtime: ILanguageRuntime): void {
		// Start the lenguage runtime.
		this._runningLanguageRuntimesMap.set(runtime.metadata.language, runtime);
		runtime.start().then(_ => {
			// TODO@softwarenerd - I think this should be moved out of this layer.
			// Execute the Focus into Console command using the command service
			// to expose the REPL for the new runtime.
			this._commandService.executeCommand('workbench.panel.console.focus');
		});

		// Fire the did start runtime event.
		this._onDidStartRuntime.fire(runtime);

		// Change the active runtime.
		this._activeRuntime = runtime;
		this._onDidChangeActiveRuntime.fire(runtime);
	}

	//#region Private Methods
}

registerSingleton(ILanguageRuntimeService, LanguageRuntimeService, InstantiationType.Delayed);
