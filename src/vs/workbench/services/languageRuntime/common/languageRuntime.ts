/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { CommandsRegistry, ICommandService } from 'vs/platform/commands/common/commands';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { formatLanguageRuntime, ILanguageRuntime, ILanguageRuntimeGlobalEvent, ILanguageRuntimeService, ILanguageRuntimeStateEvent, LanguageRuntimeDiscoveryPhase, LanguageRuntimeStartupBehavior, RuntimeClientType, RuntimeExitReason, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { FrontEndClientInstance, IFrontEndClientMessageInput, IFrontEndClientMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeFrontEndClient';
import { LanguageRuntimeWorkspaceAffiliation } from 'vs/workbench/services/languageRuntime/common/languageRuntimeWorkspaceAffiliation';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { DeferredPromise } from 'vs/base/common/async';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IModalDialogPromptInstance, IPositronModalDialogsService } from 'vs/workbench/services/positronModalDialogs/common/positronModalDialogs';
import { IOpener, IOpenerService, OpenExternalOptions, OpenInternalOptions } from 'vs/platform/opener/common/opener';
import { URI } from 'vs/base/common/uri';

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
export class LanguageRuntimeService extends Disposable implements ILanguageRuntimeService, IOpener {
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

	// A map of runtimes currently starting to promises that resolve when the runtime
	// is ready to use. This is keyed by the runtimeId (metadata.runtimeId) of the runtime.
	private readonly _startingRuntimesByRuntimeId = new Map<string, DeferredPromise<void>>();

	// A map of the running runtimes. This is keyed by the languageId
	// (metadata.languageId) of the runtime.
	private readonly _runningRuntimesByLanguageId = new Map<string, ILanguageRuntime>();

	// A map of most recently started runtimes. This is keyed by the languageId
	// (metadata.languageId) of the runtime.
	private readonly _mostRecentlyStartedRuntimesByLanguageId = new Map<string, ILanguageRuntime>();

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
	 * @param _commandService The command service.
	 * @param _extensionService The extension service.
	 * @param _languageService The language service.
	 * @param _logService The log service.
	 * @param _notificationService The notification service.
	 * @param _openerService The opener service.
	 * @param _positronModalDialogsService The Positron modal dialog service.
	 * @param _storageService The storage service.
	 * @param _workspaceTrustManagementService The workspace trust management service.
	 */
	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IPositronModalDialogsService private readonly _positronModalDialogsService: IPositronModalDialogsService,
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService,
	) {
		// Call the base class's constructor.
		super();

		// Start the Positron extensions.
		this._commandService.executeCommand('positron.activateInterpreters');

		// Create the object that tracks the affiliation of runtimes to workspaces.
		this._workspaceAffiliation =
			new LanguageRuntimeWorkspaceAffiliation(this, this._storageService, this._logService);
		this._register(this._workspaceAffiliation);

		// Register as an opener in the opener service.
		this._openerService.registerOpener(this);

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

	// An event that fires when a new runtime is registered.
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

			// We wait for `onDidEndSession()` rather than `RuntimeState.Exited`, because the former
			// generates some Console output that must finish before starting up a new runtime:
			const promise = new Promise<void>(resolve => {
				const disposable = runningRuntime.onDidEndSession((exit) => {
					resolve();
					disposable.dispose();
				});
			});

			const timeout = new Promise<void>((_, reject) => {
				setTimeout(() => {
					reject(new Error(`Timed out waiting for runtime ${formatLanguageRuntime(runningRuntime)} to finish exiting.`));
				}, 5000);
			});

			// Ask the runtime to shut down.
			await runningRuntime.shutdown(RuntimeExitReason.SwitchRuntime);

			// Wait for the runtime onDidEndSession to resolve, or for the timeout to expire
			// (whichever comes first)
			await Promise.race([promise, timeout]);
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

				case RuntimeState.Interrupting:
					this.waitForInterrupt(runtime);
					break;

				case RuntimeState.Exiting:
					this.waitForShutdown(runtime);
					break;

				case RuntimeState.Offline:
					this.waitForReconnect(runtime);
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
			}
		}));

		this._register(runtime.onDidEndSession(async exit => {
			// If the runtime is restarting and has just exited, let Positron know that it's
			// about to start again. Note that we need to do this on the next tick since we
			// need to ensure all the event handlers for the state change we
			// are currently processing have been called (i.e. everyone knows it has exited)
			setTimeout(() => {
				if (languageRuntimeInfo.state === RuntimeState.Exited &&
					exit.reason === RuntimeExitReason.Restart) {
					this._onWillStartRuntimeEmitter.fire(runtime);
				}
			}, 0);

			// If the runtime crashed, try to restart it.
			if (exit.reason === RuntimeExitReason.Error ||
				exit.reason === RuntimeExitReason.Unknown) {

				// Wait a beat, then start the runtime.
				await new Promise<void>(resolve => setTimeout(resolve, 250));
				this._onWillStartRuntimeEmitter.fire(runtime);
				await this.startRuntime(runtime.metadata.runtimeId,
					`The runtime exited unexpectedly and is being restarted automatically.`);

				// Let the user know what we did.
				const msg = nls.localize('positronConsole.runtimeCrashed', "{0} exited unexpectedly and was automatically restarted. You may have lost unsaved work.\nExit code: {1}", runtime.metadata.runtimeName, exit.exit_code);
				this._notificationService.warn(msg);
			}
		}));

		return toDisposable(() => {
			// Remove the runtime from the set of starting or running runtimes.
			this._startingRuntimesByLanguageId.delete(runtime.metadata.languageId);
			this._runningRuntimesByLanguageId.delete(runtime.metadata.languageId);
		});
	}

	getPreferredRuntime(languageId: string): ILanguageRuntime {
		// If there's a running runtime for the language, return it.
		const runningRuntime = this._runningRuntimesByLanguageId.get(languageId);
		if (runningRuntime) {
			return runningRuntime;
		}

		// If there's a starting runtime for the language, return it.
		const startingRuntime = this._startingRuntimesByLanguageId.get(languageId);
		if (startingRuntime) {
			return startingRuntime;
		}

		// If there's a runtime affiliated with the workspace for the language,
		// return it.
		const affiliatedRuntimeId = this._workspaceAffiliation.getAffiliatedRuntimeId(languageId);
		if (affiliatedRuntimeId) {
			const affiliatedRuntimeInfo = this._registeredRuntimesByRuntimeId.get(affiliatedRuntimeId);
			if (affiliatedRuntimeInfo) {
				return affiliatedRuntimeInfo.runtime;
			}
		}

		// If there is a most recently started runtime for the language, return it.
		const mostRecentlyStartedRuntime = this._mostRecentlyStartedRuntimesByLanguageId.get(languageId);
		if (mostRecentlyStartedRuntime) {
			return mostRecentlyStartedRuntime;
		}

		// If there are registered runtimes for the language, return the first.
		const languageRuntimeInfos = this._registeredRuntimes.filter(
			info => info.runtime.metadata.languageId === languageId);
		if (languageRuntimeInfos.length) {
			return languageRuntimeInfos[0].runtime;
		}

		// There are no registered runtimes for the language, throw an error.
		throw new Error(`No language runtimes registered for language ID '${languageId}'.`);
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
		// See if we are already starting a runtime with the given ID. If we
		// are, return the promise that resolves when the runtime is ready to
		// use. This makes it possible for multiple requests to start the same
		// runtime to be coalesced.
		const startingRuntimePromise = this._startingRuntimesByRuntimeId.get(runtimeId);
		if (startingRuntimePromise && !startingRuntimePromise.isSettled) {
			return startingRuntimePromise.p;
		}

		// Get the runtime. Throw an error, if it could not be found.
		const languageRuntimeInfo = this._registeredRuntimesByRuntimeId.get(runtimeId);
		if (!languageRuntimeInfo) {
			throw new Error(`No language runtime with id '${runtimeId}' was found.`);
		}

		// If there is already a runtime starting for the language, throw an error.
		const startingLanguageRuntime = this._startingRuntimesByLanguageId.get(languageRuntimeInfo.runtime.metadata.languageId);
		if (startingLanguageRuntime) {
			throw new Error(`Language runtime ${formatLanguageRuntime(languageRuntimeInfo.runtime)} cannot be started because language runtime ${formatLanguageRuntime(startingLanguageRuntime)} is already starting for the language.`);
		}

		// If there is already a runtime running for the language, throw an error.
		const runningLanguageRuntime = this._runningRuntimesByLanguageId.get(languageRuntimeInfo.runtime.metadata.languageId);
		if (runningLanguageRuntime) {
			if (runningLanguageRuntime.metadata.runtimeId === runtimeId) {
				// If the runtime that is running is the one we were just asked
				// to start, we're technically in good shape since the runtime
				// is already running!
				return Promise.resolve();
			} else {
				throw new Error(`Language runtime ${formatLanguageRuntime(languageRuntimeInfo.runtime)} cannot be started because language runtime ${formatLanguageRuntime(runningLanguageRuntime)} is already running for the language.`);
			}
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

	//#region IOpener Implementation

	/**
	 * Opens a resource.
	 * @param resource The resource to open.
	 * @param options The options.
	 * @returns A value which indicates whether the resource was opened.
	 */
	async open(resource: URI | string, options?: OpenInternalOptions | OpenExternalOptions): Promise<boolean> {
		// If the resource is a string, parse it as a URI.
		if (typeof resource === 'string') {
			resource = URI.parse(resource);
		}

		// Options cannot be handled.
		if (options) {
			return false;
		}

		// Enumerate the running runtimes and attempt to open the resource.
		for (const runtime of this._runningRuntimesByLanguageId.values()) {
			try {
				if (await runtime.openResource(resource)) {
					return true;
				}
			} catch (reason) {
				this._logService.error(`Error opening resource "${resource.toString()}". Reason: ${reason}`);
			}
		}

		// The resource was not opened.
		return false;
	}

	//#endregion IOpener Implementation

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

		// Create a promise that resolves when the runtime is ready to use.
		const startPromise = new DeferredPromise<void>();
		this._startingRuntimesByRuntimeId.set(runtime.metadata.runtimeId, startPromise);

		// Fire the onWillStartRuntime event.
		this._onWillStartRuntimeEmitter.fire(runtime);

		try {
			// Attempt to start the runtime.
			await runtime.start();

			// Resolve the deferred promise.
			startPromise.complete();

			// The runtime started. Move it from the starting runtimes to the
			// running runtimes.
			this._startingRuntimesByLanguageId.delete(runtime.metadata.languageId);
			this._startingRuntimesByRuntimeId.delete(runtime.metadata.runtimeId);
			this._runningRuntimesByLanguageId.set(runtime.metadata.languageId, runtime);
			this._mostRecentlyStartedRuntimesByLanguageId.set(runtime.metadata.languageId, runtime);

			// Fire the onDidStartRuntime event.
			this._onDidStartRuntimeEmitter.fire(runtime);

			// Make the newly-started runtime the active runtime.
			this.activeRuntime = runtime;
		} catch (reason) {
			// Reject the deferred promise.
			startPromise.error(reason);

			// Remove the runtime from the starting runtimes.
			this._startingRuntimesByLanguageId.delete(runtime.metadata.languageId);
			this._startingRuntimesByRuntimeId.delete(runtime.metadata.runtimeId);

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
			return this.startRuntime(runtime.metadata.runtimeId, `'Restart Interpreter' command invoked`);
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

	/**
	 * Waits for the runtime to report that interrupt processing is complete (by
	 * returning to the idle state). If the runtime does not return to the idle
	 * state within 10 seconds, the user is given the option to force-quit the
	 * runtime.
	 *
	 * @param runtime The runtime to watch.
	 */
	private async waitForInterrupt(runtime: ILanguageRuntime) {
		const warning = nls.localize('positron.runtimeInterruptTimeoutWarning', "{0} isn't responding to your request to interrupt the command. Do you want to forcefully quit your {1} session? You'll lose any unsaved objects.", runtime.metadata.runtimeName, runtime.metadata.languageName);
		this.awaitStateChange(runtime,
			[RuntimeState.Idle],
			10,
			warning);
	}

	/**
	 * Waits for the runtime to report that shutdown processing is complete (by
	 * exiting). If the runtime does not shut down within 10 seconds, the user
	 * is given the option to force-quit the runtime.
	 *
	 * @param runtime The runtime to watch.
	 */
	private async waitForShutdown(runtime: ILanguageRuntime) {
		const warning = nls.localize('positron.runtimeShutdownTimeoutWarning', "{0} isn't responding to your request to shut down the session. Do you want use a forced quit to end your {1} session? You'll lose any unsaved objects.", runtime.metadata.runtimeName, runtime.metadata.languageName);
		this.awaitStateChange(runtime,
			[RuntimeState.Exited],
			10,
			warning);
	}

	/**
	 * Waits for the runtime to report that it has reconnected (by returning to
	 * the Ready state). If the runtime does reconnect within 30 seconds, the
	 * user is given the option to force-quit the runtime.
	 *
	 * @param runtime The runtime to watch.
	 */
	private async waitForReconnect(runtime: ILanguageRuntime) {
		const warning = nls.localize('positron.runtimeReconnectTimeoutWarning', "{0} has been offline for more than 30 seconds. Do you want to force quit your {1} session? You'll lose any unsaved objects.", runtime.metadata.runtimeName, runtime.metadata.languageName);
		this.awaitStateChange(runtime,
			[RuntimeState.Ready, RuntimeState.Idle],
			30,
			warning);
	}

	/**
	 * Waits for the runtime to change one of the target states. If the runtime
	 * does not change to one of the target states within the specified number
	 * of seconds, a warning is displayed with an option to force quit the
	 * runtime.
	 *
	 * @param runtime The runtime to watch.
	 * @param targetStates The target state(s) for the runtime to enter.
	 * @param seconds The number of seconds to wait for the runtime to change to the target state.
	 * @param warning The warning to display if the runtime does not change to the target state.
	 */
	private async awaitStateChange(runtime: ILanguageRuntime,
		targetStates: RuntimeState[],
		seconds: number,
		warning: string) {

		let disposable: IDisposable | undefined = undefined;
		let prompt: IModalDialogPromptInstance | undefined = undefined;

		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				// We timed out; reject the promise.
				reject();

				// Show a prompt to the user asking if they want to force quit the runtime.
				prompt = this._positronModalDialogsService.showModalDialogPrompt(
					nls.localize('positron.runtimeNotResponding', "{0} is not responding", runtime.metadata.runtimeName),
					warning,
					nls.localize('positron.runtimeForceQuit', "Force Quit"),
					nls.localize('positron.runtimeKeepWaiting', "Wait"));

				prompt.onChoice((choice) => {
					// If the user chose to force quit the runtime, do so.
					if (choice) {
						runtime.forceQuit();
					}
					// Regardless of their choice, we are done waiting for a state change.
					if (disposable) {
						disposable.dispose();
					}
				});
			}, seconds * 1000);

			// Listen for state changes.
			disposable = runtime.onDidChangeRuntimeState(state => {
				if (targetStates.includes(state)) {
					clearTimeout(timer);
					resolve();

					// If we were prompting the user to force quit the runtime,
					// close the prompt ourselves since the runtime is now
					// responding.
					if (prompt) {
						prompt.close();
					}
					disposable?.dispose();
				}
			});
		});
	}

	//#endregion Private Methods
}

CommandsRegistry.registerCommand('positron.activateInterpreters', () => true);

// Instantiate the language runtime service "eagerly", meaning as soon as a
// consumer depdends on it. This fixes an issue where languages are encountered
// BEFORE the language runtime service has been instantiated.
registerSingleton(ILanguageRuntimeService, LanguageRuntimeService, InstantiationType.Eager);
