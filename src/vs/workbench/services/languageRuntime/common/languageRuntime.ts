/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { formatLanguageRuntime, ILanguageRuntime, ILanguageRuntimeGlobalEvent, ILanguageRuntimeService, ILanguageRuntimeStateEvent, LanguageRuntimeDiscoveryPhase, LanguageRuntimeStartupBehavior, RuntimeClientType, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { FrontEndClientInstance, IFrontEndClientMessageInput, IFrontEndClientMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeFrontEndClient';
import { LanguageRuntimeWorkspaceAffiliation } from 'vs/workbench/services/languageRuntime/common/languageRuntimeWorkspaceAffiliation';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';

/**
 * LanguageRuntimeInfo class.
 */
class LanguageRuntimeInfo {
	public state: RuntimeState;
	public restarting = false;
	constructor(
		public readonly runtime: ILanguageRuntime,
		public readonly startupBehavior: LanguageRuntimeStartupBehavior) {
		this.state = runtime.getRuntimeState();
	}
	setState(state: RuntimeState): void {
		this.state = state;

		// Dependents check the value of `restarting` to determine whether an `Exited` state
		// was preceeded by `Restarting`.
		if (state === RuntimeState.Restarting) {
			this.restarting = true;
		} else if (state === RuntimeState.Initializing) {
			this.restarting = false;
		}
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

	// The current discovery phase for language runtime registration.
	private _discoveryPhase: LanguageRuntimeDiscoveryPhase =
		LanguageRuntimeDiscoveryPhase.AwaitingExtensions;

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

	// The object that manages the runtimes affliated with workspaces.
	private readonly _workspaceAffiliation: LanguageRuntimeWorkspaceAffiliation;

	// The event emitter for the onDidChangeDisoveryPhase event.
	private readonly _onDidChangeDiscoveryPhaseEmitter = this._register(new Emitter<LanguageRuntimeDiscoveryPhase>);

	// The event emitter for the onDidRegisterRuntime event.
	private readonly _onDidRegisterRuntimeEmitter = this._register(new Emitter<ILanguageRuntime>);

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
	 * @param _storageService The storage service.
	 */
	constructor(
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILogService private readonly _logService: ILogService,
		@IStorageService private readonly _storageService: IStorageService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService
	) {
		// Call the base class's constructor.
		super();

		// Create the object that tracks the affiliation of runtimes to workspaces.
		this._workspaceAffiliation =
			new LanguageRuntimeWorkspaceAffiliation(this, this._storageService, this._logService);
		this._register(this._workspaceAffiliation);

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
			this.autoStartRuntime(languageRuntimeInfos[0].runtime,
				`A file with the language ID ${languageId} was opened.`);
		}));

		// Begin discovering language runtimes once all extensions have been
		// registered.
		this._extensionService.whenAllExtensionHostsStarted().then(() => {
			this._onDidChangeDiscoveryPhaseEmitter.fire(LanguageRuntimeDiscoveryPhase.Discovering);
		});

		// Update the discovery phase when the language service's state changes.
		this.onDidChangeDiscoveryPhase(phase => {
			this._discoveryPhase = phase;
		});
	}

	//#endregion Constructor

	//#region ILanguageRuntimeService Implementation

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	// An event that fires when the language runtime discovery phase changes.
	readonly onDidChangeDiscoveryPhase = this._onDidChangeDiscoveryPhaseEmitter.event;

	// An event that fires when a runtime is about to start.
	readonly onDidRegisterRuntime = this._onDidRegisterRuntimeEmitter.event;

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
	 * Selects and starts a runtime, after shutting down any currently active
	 * runtimes for the language.
	 *
	 * @param runtimeId The ID of the runtime to select
	 * @param source The source of the selection
	 */
	async selectRuntime(runtimeId: string, source: string): Promise<void> {
		const runtimeInfo = this._registeredRuntimesByRuntimeId.get(runtimeId);
		if (!runtimeInfo) {
			return Promise.reject(new Error(`Language runtime ID '${runtimeId}' ` +
				`is not registered.`));
		}
		const runtime = runtimeInfo.runtime;

		// Shut down any other runtimes for the language.
		const runningRuntime = this._runningRuntimesByLanguageId.get(runtime.metadata.languageId);
		if (runningRuntime) {
			// Is this, by chance, the runtime that's already running?
			if (runningRuntime.metadata.runtimeId === runtimeId) {
				return Promise.reject(
					new Error(`${formatLanguageRuntime(runningRuntime)} is already running.`));
			}

			// Ask the runtime to shut down.
			await runningRuntime.shutdown();

			// If the runtime doesn't exit immediately, wait for it to exit.
			if (runningRuntime.getRuntimeState() !== RuntimeState.Exited) {
				// Create a promise that resolves when the runtime exits.
				const promise = new Promise<void>(resolve => {
					const disposable = runningRuntime.onDidChangeRuntimeState(state => {
						if (state === RuntimeState.Exited) {
							resolve();
							disposable.dispose();
						}
					});
				});

				// Create a promise that rejects after a timeout.
				const timeout = new Promise<void>((_, reject) => {
					setTimeout(() => {
						reject(new Error(`Timed out waiting for runtime ${formatLanguageRuntime(runningRuntime)} to exit.`));
					}, 5000);
				});

				// Wait for the runtime to exit, or for the timeout to expire
				// (whichever comes first)
				await Promise.race([promise, timeout]);
			}
		}

		// Start the selected runtime.
		return this.startRuntime(runtime.metadata.runtimeId, source);
	}

	/**
	 * Register a new runtime
	 *
	 * @param runtime The runtime to register
	 * @returns A disposable that unregisters the runtime
	 */
	registerRuntime(runtime: ILanguageRuntime, startupBehavior: LanguageRuntimeStartupBehavior): IDisposable {
		// If the runtime has already been registered, throw an error.
		if (this._registeredRuntimesByRuntimeId.has(runtime.metadata.runtimeId)) {
			throw new Error(`Language runtime ${formatLanguageRuntime(runtime)} has already been registered.`);
		}

		// Add the runtime to the registered runtimes.
		const languageRuntimeInfo = new LanguageRuntimeInfo(runtime, startupBehavior);
		this._registeredRuntimes.push(languageRuntimeInfo);
		this._registeredRuntimesByRuntimeId.set(runtime.metadata.runtimeId, languageRuntimeInfo);

		// Signal that the set of registered runtimes has changed.
		this._onDidRegisterRuntimeEmitter.fire(runtime);

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

		// Automatically start the language runtime under the following conditions:
		// - We have encountered the language that the runtime serves.
		// - The runtime is not already starting or running.
		// - The runtime has implicit startup behavior.
		// - There's no runtime affiliated with the current workspace for this
		//   language (if there is, we want that runtime to start, not this one)
		if (this._encounteredLanguagesByLanguageId.has(runtime.metadata.languageId) &&
			!this.runtimeForLanguageIsStartingOrRunning(runtime.metadata.languageId) &&
			startupBehavior === LanguageRuntimeStartupBehavior.Implicit &&
			!this._workspaceAffiliation.getAffiliatedRuntimeId(runtime.metadata.languageId)) {

			this.autoStartRuntime(languageRuntimeInfo.runtime,
				`A file with the language ID ${runtime.metadata.languageId} was open ` +
				`when the runtime was registered.`);
		}

		// Automatically start the language runtime under the following conditions:
		// - The language runtime wants to start immediately.
		// - No other runtime is currently running.
		// - We have completed the discovery phase of the language runtime
		//   registration process.
		else if (startupBehavior === LanguageRuntimeStartupBehavior.Immediate &&
			this._discoveryPhase === LanguageRuntimeDiscoveryPhase.Complete &&
			!this.hasAnyStartedOrRunningRuntimes()) {

			this.autoStartRuntime(languageRuntimeInfo.runtime,
				`An extension requested that the runtime start immediately after being registered.`);
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
					if (runtime !== this._activeRuntime) {
						// If this runtime isn't already active, activate it. We
						// avoid re-activation if already active since the
						// resulting events can cause Positron behave as though
						// a new runtime were started (e.g. focusing the
						// console)
						this.activeRuntime = runtime;
					}

					// @TODO@softwarenerd - Talk with the team about this.
					// // If the runtime is ready, and we have no active runtime,
					// // set the active runtime to the new runtime.
					// if (!this._activeRuntime || this._activeRuntime.metadata.languageId === runtime.metadata.languageId) {
					// 	this.activeRuntime = runtime;
					// }

					// Start the frontend client instance once the runtime is fully online.
					this.startFrontEndClient(runtime);
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
					if (languageRuntimeInfo.restarting && state === RuntimeState.Exited) {
						this._onWillStartRuntimeEmitter.fire(runtime);
					}
				}, 0);
			}
		}));

		return toDisposable(() => {
			// Remove the runtime from the set of starting or running runtimes.
			this._startingRuntimesByLanguageId.delete(runtime.metadata.languageId);
			this._runningRuntimesByLanguageId.delete(runtime.metadata.languageId);
		});
	}

	/**
	 * Completes the language runtime discovery phase. If no runtimes were
	 * started or will be started, automatically start one.
	 */
	completeDiscovery(): void {
		this._onDidChangeDiscoveryPhaseEmitter.fire(LanguageRuntimeDiscoveryPhase.Complete);

		if (!this._workspaceAffiliation.hasAffiliatedRuntime() &&
			!this.hasAnyStartedOrRunningRuntimes()) {
			// If there are no affiliated runtimes, and no starting or running
			// runtimes, start the first runtime that has Immediate startup
			// behavior.
			const languageRuntimeInfos = this._registeredRuntimes.filter(
				info => info.startupBehavior === LanguageRuntimeStartupBehavior.Immediate);
			if (languageRuntimeInfos.length) {
				this.autoStartRuntime(languageRuntimeInfos[0].runtime,
					`An extension requested the runtime to be started immediately.`);
			}
		}
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
	 * @param source The source of the request to start the runtime.
	 */
	async startRuntime(runtimeId: string, source: string): Promise<void> {
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

		// If the workspace is not trusted, defer starting the runtime until the
		// workspace is trusted.
		if (!this._workspaceTrustManagementService.isWorkspaceTrusted()) {
			return this.autoStartRuntime(languageRuntimeInfo.runtime, source);
		}

		// Start the runtime.
		this._logService.info(`Starting language runtime ${formatLanguageRuntime(languageRuntimeInfo.runtime)} (Source: ${source})`);
		await this.doStartRuntime(languageRuntimeInfo.runtime);
	}

	/**
	 * Restarts a runtime.
	 * @param runtimeId The ID of the runtime to restart
	 * @param source The source of the request to restart the runtime.
	 */
	async restartRuntime(runtimeId: string, source: string): Promise<void> {
		const runtimeInfo = this._registeredRuntimesByRuntimeId.get(runtimeId);
		if (!runtimeInfo) {
			throw new Error(`No language runtime with id '${runtimeId}' was found.`);
		}
		const runtime = runtimeInfo.runtime;
		this._logService.info(`Restarting language runtime ${formatLanguageRuntime(runtime)} (Source: ${source})`);
		await this.doRestartRuntime(runtime);
	}

	//#endregion ILanguageRuntimeService Implementation

	//#region Private Methods

	/**
	 * Starts a frontend client instance for the specified runtime. The frontend
	 * client instance is used to carry global Positron events from the runtime
	 * to the frontend.
	 *
	 * @param runtime The runtime for which to start the frontend client.
	 */
	private startFrontEndClient(runtime: ILanguageRuntime): void {
		// Create the frontend client. The second argument is empty for now; we
		// could use this to pass in any initial state we want to pass to the
		// frontend client (such as information on window geometry, etc.)
		runtime.createClient<IFrontEndClientMessageInput, IFrontEndClientMessageOutput>
			(RuntimeClientType.FrontEnd, {}).then(client => {
				// Create the frontend client instance wrapping the client instance.
				const frontendClient = new FrontEndClientInstance(client);

				// When the frontend client instance emits an event, broadcast
				// it to Positron.
				this._register(frontendClient.onDidEmitEvent(event => {
					this._onDidReceiveRuntimeEventEmitter.fire({
						runtime_id: runtime.metadata.runtimeId,
						event
					});
				}));
				this._register(frontendClient);
			});
	}

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
	 * Checks to see if any of the registered runtimes are starting or running.
	 */
	private hasAnyStartedOrRunningRuntimes(): boolean {
		return this._startingRuntimesByLanguageId.size > 0 ||
			this._runningRuntimesByLanguageId.size > 0;
	}

	/**
	 * Automatically starts a runtime.
	 *
	 * @param runtime The runtime to start.
	 * @param source The source of the request to start the runtime.
	 */
	private async autoStartRuntime(runtime: ILanguageRuntime, source: string): Promise<void> {
		if (this._workspaceTrustManagementService.isWorkspaceTrusted()) {
			// If the workspace is trusted, start the runtime.
			this._logService.info(`Language runtime ` +
				`${formatLanguageRuntime(runtime)} ` +
				`automatically starting. Source: ${source}`);
			await this.doStartRuntime(runtime);
		} else {
			this._logService.debug(`Deferring the start of language runtime ` +
				`${formatLanguageRuntime(runtime)} (Source: ${source}) ` +
				`because workspace trust has not been granted. ` +
				`The runtime will be started when workspace trust is granted.`);
			this._workspaceTrustManagementService.onDidChangeTrust((trusted) => {
				if (!trusted) {
					// If the workspace is still not trusted, do nothing.
					return;
				}
				// If the workspace is trusted, start the runtime.
				this._logService.info(`Language runtime ` +
					`${formatLanguageRuntime(runtime)} ` +
					`automatically starting after workspace trust was granted. ` +
					`Source: ${source}`);
				this.doStartRuntime(runtime);
			});
		}
	}

	/**
	 * Starts a runtime.
	 * @param runtime The runtime to start.
	 */
	private async doStartRuntime(runtime: ILanguageRuntime): Promise<void> {
		// Add the runtime to the starting runtimes.
		this._startingRuntimesByLanguageId.set(runtime.metadata.languageId, runtime);

		// Fire the onWillStartRuntime event.
		this._onWillStartRuntimeEmitter.fire(runtime);

		try {
			// Attempt to start the runtime.
			await runtime.start();

			// The runtime started. Move it from the starting runtimes to the
			// running runtimes.
			this._startingRuntimesByLanguageId.delete(runtime.metadata.languageId);
			this._runningRuntimesByLanguageId.set(runtime.metadata.languageId, runtime);

			// Fire the onDidStartRuntime event.
			this._onDidStartRuntimeEmitter.fire(runtime);

			// Make the newly-started runtime the active runtime.
			this.activeRuntime = runtime;
		} catch (reason) {
			// Remove the runtime from the starting runtimes.
			this._startingRuntimesByLanguageId.delete(runtime.metadata.languageId);

			// Fire the onDidFailStartRuntime event.
			this._onDidFailStartRuntimeEmitter.fire(runtime);

			// TODO@softwarenerd - We should do something with the reason.
			this._logService.error(`Starting language runtime failed. Reason: ${reason}`);
		}
	}

	/**
	 * Restarts a runtime.
	 * @param runtime The runtime to restart.
	 */
	private async doRestartRuntime(runtime: ILanguageRuntime): Promise<void> {
		const state = runtime.getRuntimeState();
		if (state === RuntimeState.Busy ||
			state === RuntimeState.Idle ||
			state === RuntimeState.Ready) {
			// The runtime looks like it could handle a restart request, so send
			// one over.
			return runtime.restart();
		} else if (state === RuntimeState.Uninitialized ||
			state === RuntimeState.Exited) {
			// The runtime has never been started, or is no longer running. Just
			// tell it to start.
			return this.startRuntime(runtime.metadata.runtimeId, `'Restart Language Runtime' command invoked`);
		} else if (state === RuntimeState.Starting ||
			state === RuntimeState.Restarting) {
			// The runtime is already starting or restarting. We could show an
			// error, but this is probably just the result of a user mashing the
			// restart when we already have one in flight.
			return;
		} else {
			// The runtime is not in a state where it can be restarted.
			return Promise.reject(
				new Error(`The ${runtime.metadata.languageName} language runtime is '${state}' and cannot be restarted.`)
			);
		}
	}

	//#region Private Methods
}

// Instantiate the language runtime service "eagerly", meaning as soon as a
// consumer depdends on it. This fixes an issue where languages are encountered
// BEFORE the language runtime service has been instantiated.
registerSingleton(ILanguageRuntimeService, LanguageRuntimeService, InstantiationType.Eager);
