/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { DeferredPromise } from 'vs/base/common/async';
import { Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';
import { IOpener, IOpenerService, OpenExternalOptions, OpenInternalOptions } from 'vs/platform/opener/common/opener';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionMode, RuntimeExitReason, RuntimeState, formatLanguageRuntimeMetadata, formatLanguageRuntimeSession } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeGlobalEvent, ILanguageRuntimeSession, ILanguageRuntimeSessionManager, ILanguageRuntimeSessionStateEvent, IRuntimeSessionService, RuntimeClientType } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IModalDialogPromptInstance, IPositronModalDialogsService } from 'vs/workbench/services/positronModalDialogs/common/positronModalDialogs';
import { IUiClientMessageInput, IUiClientMessageOutput, UiClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeUiClient';
import { UiFrontendEvent } from 'vs/workbench/services/languageRuntime/common/positronUiComm';
import { INotificationService } from 'vs/platform/notification/common/notification';

class LanguageRuntimeSessionInfo {
	public state: RuntimeState;
	constructor(public session: ILanguageRuntimeSession) {
		this.state = session.getRuntimeState();
	}
}
/**
 * The implementation of ILanguageRuntimeService
 */
export class RuntimeSessionService extends Disposable implements IRuntimeSessionService, IOpener {

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	// The session manager.
	private _sessionManager: ILanguageRuntimeSessionManager | undefined;

	/**
	 * The foreground session. This is the session that is currently active in
	 * the Console view.
	 */
	private _foregroundSession?: ILanguageRuntimeSession;

	// A map of the currently active sessions. This is keyed by the session ID.
	private readonly _activeSessionsBySessionId = new Map<string, LanguageRuntimeSessionInfo>();

	// A map of the starting consoles. This is keyed by the languageId
	// (metadata.languageId) of the runtime owning the session.
	private readonly _startingConsolesByLanguageId = new Map<string, ILanguageRuntimeMetadata>();

	// A map of runtimes currently starting to promises that resolve when the runtime
	// is ready to use. This is keyed by the runtimeId (metadata.runtimeId) of the runtime.
	private readonly _startingRuntimesByRuntimeId = new Map<string, DeferredPromise<string>>();

	// A map of the currently active console sessions. Since we can currently
	// only have one console session per language, this is keyed by the
	// languageId (metadata.languageId) of the session.
	private readonly _consoleSessionsByLanguageId = new Map<string, ILanguageRuntimeSession>();

	// The event emitter for the onWillStartRuntime event.
	private readonly _onWillStartRuntimeEmitter =
		this._register(new Emitter<ILanguageRuntimeSession>);

	// The event emitter for the onDidStartRuntime event.
	private readonly _onDidStartRuntimeEmitter =
		this._register(new Emitter<ILanguageRuntimeSession>);

	// The event emitter for the onDidFailStartRuntime event.
	private readonly _onDidFailStartRuntimeEmitter =
		this._register(new Emitter<ILanguageRuntimeSession>);

	// The event emitter for the onDidReconnectRuntime event.
	private readonly _onDidReconnectRuntimeEmitter =
		this._register(new Emitter<ILanguageRuntimeSession>);

	// The event emitter for the onDidChangeRuntimeState event.
	private readonly _onDidChangeRuntimeStateEmitter =
		this._register(new Emitter<ILanguageRuntimeSessionStateEvent>());

	// The event emitter for the onDidReceiveRuntimeEvent event.
	private readonly _onDidReceiveRuntimeEventEmitter =
		this._register(new Emitter<ILanguageRuntimeGlobalEvent>());

	// The event emitter for the onDidChangeActiveRuntime event.
	private readonly _onDidChangeActiveRuntimeEmitter =
		this._register(new Emitter<ILanguageRuntimeSession | undefined>);

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@ILogService private readonly _logService: ILogService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IPositronModalDialogsService private readonly _positronModalDialogsService: IPositronModalDialogsService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService) {

		super();

		// Register as an opener in the opener service.
		this._openerService.registerOpener(this);
	}

	//#region ILanguageRuntimeService Implementation

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
	readonly onDidChangeForegroundSession = this._onDidChangeActiveRuntimeEmitter.event;

	/**
	 * Registers the session manager with the service.
	 *
	 * Currently there's only one of these, and it's registered by the extension
	 * host, which provides sessions from extensions (language packs).
	 *
	 * @param manager The session manager to register
	 */
	registerSessionManager(manager: ILanguageRuntimeSessionManager): void {
		if (this._sessionManager === manager) {
			return;
		}
		if (this._sessionManager) {
			this._logService.warn(
				`Language runtime service already has a session manager registered!`);
		}
		this._sessionManager = manager;
	}

	/**
	 * Gets the console session for a runtime, if one exists.
	 *
	 * @param runtimeId The runtime identifier of the session to retrieve.
	 * @returns The console session with the given runtime identifier, or undefined if
	 *  no console session with the given runtime identifier exists.
	 */
	getConsoleSessionForRuntime(runtimeId: string): ILanguageRuntimeSession | undefined {
		const session = Array.from(this._activeSessionsBySessionId.values()).find(session =>
			session.session.metadata.runtimeId === runtimeId &&
			session.session.sessionMode === LanguageRuntimeSessionMode.Console);
		if (session) {
			return session.session;
		} else {
			return undefined;
		}
	}

	/**
	 * Gets the console session for a language, if one exists.
	 *
	 * @param languageId The language identifier of the session to retrieve.
	 * @returns The console session with the given language identifier, or undefined if
	 *  no console session with the given language identifier exists.
	 */
	getConsoleSessionForLanguage(runtimeId: string): ILanguageRuntimeSession | undefined {
		return this._consoleSessionsByLanguageId.get(runtimeId);
	}

	/**
	 * Starts a new runtime session.
	 *
	 * @param runtimeId The runtime identifier of the runtime.
	 * @param sessionName A human readable name for the session.
	 * @param sessionMode The mode of the new session.
	 * @param source The source of the request to start the runtime.
	 */
	async startNewRuntimeSession(runtimeId: string,
		sessionName: string,
		sessionMode: LanguageRuntimeSessionMode,
		source: string): Promise<string> {
		// See if we are already starting a runtime with the given ID. If we
		// are, return the promise that resolves when the runtime is ready to
		// use. This makes it possible for multiple requests to start the same
		// runtime to be coalesced.
		const startingRuntimePromise = this._startingRuntimesByRuntimeId.get(runtimeId);
		if (startingRuntimePromise && !startingRuntimePromise.isSettled) {
			return startingRuntimePromise.p;
		}

		// Get the runtime. Throw an error, if it could not be found.
		const languageRuntime = this._languageRuntimeService.getRegisteredRuntime(runtimeId);
		if (!languageRuntime) {
			throw new Error(`No language runtime with id '${runtimeId}' was found.`);
		}

		// If there is already a runtime starting for the language, throw an error.
		if (sessionMode === LanguageRuntimeSessionMode.Console) {
			const startingLanguageRuntime = this._startingConsolesByLanguageId.get(
				languageRuntime.languageId);
			if (startingLanguageRuntime) {
				throw new Error(`Session for language runtime ${formatLanguageRuntimeMetadata(languageRuntime)} cannot be started because language runtime ${formatLanguageRuntimeMetadata(startingLanguageRuntime)} is already starting for the language.`);
			}

			// If there is already a runtime running for the language, throw an error.
			const runningLanguageRuntime =
				this._consoleSessionsByLanguageId.get(languageRuntime.languageId);
			if (runningLanguageRuntime) {
				const metadata = runningLanguageRuntime.metadata;
				if (metadata.runtimeId === runtimeId) {
					// If the runtime that is running is the one we were just asked
					// to start, we're technically in good shape since the runtime
					// is already running!
					return runningLanguageRuntime.sessionId;
				} else {
					throw new Error(`A console for ` +
						`${formatLanguageRuntimeMetadata(languageRuntime)} ` +
						`cannot be started because a console for ` +
						`${formatLanguageRuntimeMetadata(metadata)} is already running ` +
						`for the ${metadata.languageName} language.`);
				}
			}
		}

		// If the workspace is not trusted, defer starting the runtime until the
		// workspace is trusted.
		if (!this._workspaceTrustManagementService.isWorkspaceTrusted()) {
			return this.autoStartRuntime(languageRuntime, source);
		}

		// Start the runtime.
		this._logService.info(
			`Starting session for language runtime ` +
			`${formatLanguageRuntimeMetadata(languageRuntime)} (Source: ${source})`);
		return this.doStartRuntimeSession(languageRuntime, sessionName, sessionMode);
	}


	/**
	 * Sets the foreground session.
	 */
	set foregroundSession(session: ILanguageRuntimeSession | undefined) {
		// If there's nothing to do, return.
		if (!session && !this._foregroundSession) {
			return;
		}

		this._foregroundSession = session;

		// Fire the onDidChangeActiveRuntime event.
		this._onDidChangeActiveRuntimeEmitter.fire(this._foregroundSession);
	}

	/**
	 * Gets a single session, given its session ID.
	 *
	 * @param sessionId The session ID to retrieve.
	 * @returns The session with the given session ID, or undefined if no
	 *  session with the given session ID exists.
	 */
	getSession(sessionId: string): ILanguageRuntimeSession | undefined {
		return this._activeSessionsBySessionId.get(sessionId)?.session;
	}

	/**
	 * Gets the running runtimes.
	 */
	get activeSessions(): ILanguageRuntimeSession[] {
		return Array.from(this._activeSessionsBySessionId.values()).map(info => info.session);
	}

	/**
	 * Gets the foreground session.
	 */
	get foregroundSession(): ILanguageRuntimeSession | undefined {
		return this._foregroundSession;
	}

	/**
	 * Restarts a runtime session.
	 *
	 * @param sessionId The session ID of the runtime to interrupt.
	 * @param source The source of the request to restart the runtime.
	 */
	async restartRuntime(sessionId: string, source: string): Promise<void> {
		const session = this.getSession(sessionId);
		if (!session) {
			throw new Error(`No session with ID '${sessionId}' was found.`);
		}
		this._logService.info(
			`Restarting session '` +
			`${formatLanguageRuntimeSession(session)}' (Source: ${source})`);
		await this.doRestartRuntime(session);
	}

	/**
	 * Checks for a starting or running console for the given language ID.
	 *
	 * @param languageId The language ID to check for; if undefined, checks for
	 * 	any starting or running console.
	 */
	hasStartingOrRunningConsole(languageId: string | undefined) {
		if (languageId) {
			return this._startingConsolesByLanguageId.has(languageId) ||
				this._consoleSessionsByLanguageId.has(languageId);
		} else {
			return this._startingConsolesByLanguageId.size > 0 ||
				this._consoleSessionsByLanguageId.size > 0;
		}
	}

	/**
	 * Automatically starts a runtime.
	 *
	 * @param runtime The runtime to start.
	 * @param source The source of the request to start the runtime.
	 *
	 * @returns A promise that resolves with a session ID for the new session,
	 * if one was started.
	 */
	async autoStartRuntime(
		metadata: ILanguageRuntimeMetadata,
		source: string): Promise<string> {
		// Check the setting to see if we should be auto-starting.
		const autoStart = this._configurationService.getValue<boolean>(
			'positron.interpreters.automaticStartup');
		if (!autoStart) {
			this._logService.info(`Language runtime ` +
				`${formatLanguageRuntimeMetadata(metadata)} ` +
				`was scheduled for automatic start, but won't be started because automatic ` +
				`startup is disabled in configuration. Source: ${source}`);
			return '';
		}

		if (this._workspaceTrustManagementService.isWorkspaceTrusted()) {
			// If the workspace is trusted, start the runtime.
			this._logService.info(`Language runtime ` +
				`${formatLanguageRuntimeMetadata(metadata)} ` +
				`automatically starting. Source: ${source}`);

			// Auto started runtimes are always started as console sessions.
			return this.doStartRuntimeSession(metadata,
				metadata.runtimeName, LanguageRuntimeSessionMode.Console);
		} else {
			this._logService.debug(`Deferring the start of language runtime ` +
				`${formatLanguageRuntimeMetadata(metadata)} (Source: ${source}) ` +
				`because workspace trust has not been granted. ` +
				`The runtime will be started when workspace trust is granted.`);
			this._workspaceTrustManagementService.onDidChangeTrust((trusted) => {
				if (!trusted) {
					// If the workspace is still not trusted, do nothing.
					return '';
				}
				// If the workspace is trusted, start the runtime.
				this._logService.info(`Language runtime ` +
					`${formatLanguageRuntimeMetadata(metadata)} ` +
					`automatically starting after workspace trust was granted. ` +
					`Source: ${source}`);
				return this.doStartRuntimeSession(metadata,
					metadata.runtimeName, LanguageRuntimeSessionMode.Console);
			});
		}

		return '';
	}

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

		// Enumerate the active sessions and attempt to open the resource.
		for (const session of this._consoleSessionsByLanguageId.values()) {
			try {
				if (await session.openResource(resource)) {
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
	 * Starts a runtime session.
	 *
	 * @param metadata The metadata for the runtime to start.
	 * @param sessionName A human-readable name for the session.
	 * @param sessionMode The mode for the new session.
	 *
	 * Returns a promise that resolves with the session ID when the runtime is
	 * ready to use.
	 */
	private async doStartRuntimeSession(metadata: ILanguageRuntimeMetadata,
		sessionName: string,
		sessionMode: LanguageRuntimeSessionMode): Promise<string> {
		// Add the runtime to the starting runtimes.
		if (sessionMode === LanguageRuntimeSessionMode.Console) {
			this._startingConsolesByLanguageId.set(metadata.languageId, metadata);
		}

		// Create a promise that resolves when the runtime is ready to use.
		const startPromise = new DeferredPromise<string>();
		this._startingRuntimesByRuntimeId.set(metadata.runtimeId, startPromise);

		if (!this._sessionManager) {
			throw new Error(`No session manager has been registered.`);
		}

		const sessionId = this.generateNewSessionId(metadata);
		const session = await this._sessionManager.createSession(metadata,
			sessionId,
			sessionName,
			sessionMode);

		// Fire the onWillStartRuntime event.
		this._onWillStartRuntimeEmitter.fire(session);

		// Attach event handlers to the newly provisioned session.
		this.attachToSession(session);

		try {
			// Attempt to start the session.
			await session.start();

			// Resolve the deferred promise.
			startPromise.complete(sessionId);

			// The runtime started. Move it from the starting runtimes to the
			// running runtimes.
			this._startingConsolesByLanguageId.delete(metadata.languageId);
			this._startingRuntimesByRuntimeId.delete(metadata.runtimeId);
			if (session.sessionMode === LanguageRuntimeSessionMode.Console) {
				this._consoleSessionsByLanguageId.set(metadata.languageId, session);
			}

			// Fire the onDidStartRuntime event.
			this._onDidStartRuntimeEmitter.fire(session);

			// Make the newly-started runtime the foreground runtime if it's a console session.
			if (session.sessionMode === LanguageRuntimeSessionMode.Console) {
				this._foregroundSession = session;
			}
		} catch (reason) {
			// Reject the deferred promise.
			startPromise.error(reason);

			// Remove the runtime from the starting runtimes.
			this._startingConsolesByLanguageId.delete(session.metadata.languageId);
			this._startingRuntimesByRuntimeId.delete(session.metadata.runtimeId);

			// Fire the onDidFailStartRuntime event.
			this._onDidFailStartRuntimeEmitter.fire(session);

			// TODO@softwarenerd - We should do something with the reason.
			this._logService.error(`Starting language runtime failed. Reason: ${reason}`);
		}

		return sessionId;
	}

	/**
	 * Attaches event handlers and registers a freshly created language runtime
	 * session with the service.
	 *
	 * @param session The session to attach.
	 */
	private attachToSession(session: ILanguageRuntimeSession): void {

		// Save the session info.
		this._activeSessionsBySessionId.set(session.sessionId,
			new LanguageRuntimeSessionInfo(session));

		// Add the onDidChangeRuntimeState event handler.
		this._register(session.onDidChangeRuntimeState(state => {
			// Process the state change.
			switch (state) {
				case RuntimeState.Ready:
					if (session !== this._foregroundSession &&
						session.sessionMode === LanguageRuntimeSessionMode.Console) {
						// When a new console is ready, activate it. We avoid
						// re-activation if already active since the resulting
						// events can cause Positron behave as though a new
						// runtime were started (e.g. focusing the console)
						this._foregroundSession = session;
					}

					// Start the UI client instance once the runtime is fully online.
					this.startUiClient(session);
					break;

				case RuntimeState.Interrupting:
					this.waitForInterrupt(session);
					break;

				case RuntimeState.Exiting:
					this.waitForShutdown(session);
					break;

				case RuntimeState.Offline:
					this.waitForReconnect(session);
					break;

				case RuntimeState.Exited:
					// Remove the runtime from the set of starting or running runtimes.
					this._startingConsolesByLanguageId.delete(session.metadata.languageId);
					if (session.sessionMode === LanguageRuntimeSessionMode.Console) {
						this._consoleSessionsByLanguageId.delete(session.metadata.languageId);
					}
					break;
			}

			// Let listeners know that the runtime state has changed.
			const sessionInfo = this._activeSessionsBySessionId.get(session.sessionId);
			if (!sessionInfo) {
				this._logService.error(
					`Session ${formatLanguageRuntimeSession(session)} is not active.`);
			} else {
				const oldState = sessionInfo.state;
				sessionInfo.state = state;
				this._onDidChangeRuntimeStateEmitter.fire({
					session_id: session.sessionId,
					old_state: oldState,
					new_state: state
				});
			}
		}));

		this._register(session.onDidEndSession(async exit => {
			// If the runtime is restarting and has just exited, let Positron know that it's
			// about to start again. Note that we need to do this on the next tick since we
			// need to ensure all the event handlers for the state change we
			// are currently processing have been called (i.e. everyone knows it has exited)
			setTimeout(() => {
				const sessionInfo = this._activeSessionsBySessionId.get(session.sessionId);
				if (!sessionInfo) {
					this._logService.error(
						`Session ${formatLanguageRuntimeSession(session)} is not active.`);
					return;
				}
				if (sessionInfo.state === RuntimeState.Exited &&
					exit.reason === RuntimeExitReason.Restart) {
					this._onWillStartRuntimeEmitter.fire(session);
				}
			}, 0);

			// If the runtime crashed, try to restart it.
			if (exit.reason === RuntimeExitReason.Error || exit.reason === RuntimeExitReason.Unknown) {
				const restartOnCrash =
					this._configurationService.getValue<boolean>('positron.interpreters.restartOnCrash');

				let action;

				if (restartOnCrash) {
					// Wait a beat, then start the runtime.
					await new Promise<void>(resolve => setTimeout(resolve, 250));

					await this.startNewRuntimeSession(session.metadata.runtimeId,
						session.sessionName,
						session.sessionMode,
						`The runtime exited unexpectedly and is being restarted automatically.`);
					action = 'and was automatically restarted';
				} else {
					action = 'and was not automatically restarted';
				}

				// Let the user know what we did.
				const msg = nls.localize(
					'positronConsole.runtimeCrashed',
					'{0} exited unexpectedly {1}. You may have lost unsaved work.\nExit code: {2}',
					session.metadata.runtimeName,
					action,
					exit.exit_code
				);
				this._notificationService.warn(msg);
			}
		}));
	}

	/**
	 * Restarts a runtime session.
	 *
	 * @param session The runtime to restart.
	 */
	private async doRestartRuntime(session: ILanguageRuntimeSession): Promise<void> {
		const state = session.getRuntimeState();
		if (state === RuntimeState.Busy ||
			state === RuntimeState.Idle ||
			state === RuntimeState.Ready) {
			// The runtime looks like it could handle a restart request, so send
			// one over.
			return session.restart();
		} else if (state === RuntimeState.Uninitialized ||
			state === RuntimeState.Exited) {
			// The runtime has never been started, or is no longer running. Just
			// tell it to start.
			await this.startNewRuntimeSession(session.metadata.runtimeId,
				session.sessionName,
				session.sessionMode, `'Restart Interpreter' command invoked`);
			return;
		} else if (state === RuntimeState.Starting ||
			state === RuntimeState.Restarting) {
			// The runtime is already starting or restarting. We could show an
			// error, but this is probably just the result of a user mashing the
			// restart when we already have one in flight.
			return;
		} else {
			// The runtime is not in a state where it can be restarted.
			return Promise.reject(
				new Error(`The ${session.metadata.languageName} session is '${state}' ` +
					`and cannot be restarted.`)
			);
		}
	}

	/**
	 * Waits for the runtime to report that interrupt processing is complete (by
	 * returning to the idle state). If the runtime does not return to the idle
	 * state within 10 seconds, the user is given the option to force-quit the
	 * runtime.
	 *
	 * @param session The runtime to watch.
	 */
	private async waitForInterrupt(session: ILanguageRuntimeSession) {
		const warning = nls.localize('positron.runtimeInterruptTimeoutWarning', "{0} isn't responding to your request to interrupt the command. Do you want to forcefully quit your {1} session? You'll lose any unsaved objects.", session.sessionName, session.metadata.languageName);
		this.awaitStateChange(session,
			[RuntimeState.Idle],
			10,
			warning);
	}

	/**
	 * Waits for the runtime to report that shutdown processing is complete (by
	 * exiting). If the runtime does not shut down within 10 seconds, the user
	 * is given the option to force-quit the runtime.
	 *
	 * @param session The runtime to watch.
	 */
	private async waitForShutdown(session: ILanguageRuntimeSession) {
		const warning = nls.localize('positron.runtimeShutdownTimeoutWarning', "{0} isn't responding to your request to shut down the session. Do you want use a forced quit to end your {1} session? You'll lose any unsaved objects.", session.sessionName, session.metadata.languageName);
		this.awaitStateChange(session,
			[RuntimeState.Exited],
			10,
			warning);
	}

	/**
	 * Waits for the runtime to report that it has reconnected (by returning to
	 * the Ready state). If the runtime does reconnect within 30 seconds, the
	 * user is given the option to force-quit the runtime.
	 *
	 * @param session The runtime to watch.
	 */
	private async waitForReconnect(session: ILanguageRuntimeSession) {
		const warning = nls.localize('positron.runtimeReconnectTimeoutWarning', "{0} has been offline for more than 30 seconds. Do you want to force quit your {1} session? You'll lose any unsaved objects.", session.sessionName, session.metadata.languageName);
		this.awaitStateChange(session,
			[RuntimeState.Ready, RuntimeState.Idle],
			30,
			warning);
	}

	/**
	 * Waits for the session to change one of the target states. If the runtime
	 * does not change to one of the target states within the specified number
	 * of seconds, a warning is displayed with an option to force quit the
	 * runtime.
	 *
	 * @param session The session to watch.
	 * @param targetStates The target state(s) for the runtime to enter.
	 * @param seconds The number of seconds to wait for the runtime to change to the target state.
	 * @param warning The warning to display if the runtime does not change to the target state.
	 */
	private async awaitStateChange(session: ILanguageRuntimeSession,
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
					nls.localize('positron.runtimeNotResponding', "{0} is not responding", session.metadata.runtimeName),
					warning,
					nls.localize('positron.runtimeForceQuit', "Force Quit"),
					nls.localize('positron.runtimeKeepWaiting', "Wait"));

				prompt.onChoice((choice) => {
					// If the user chose to force quit the runtime, do so.
					if (choice) {
						session.forceQuit();
					}
					// Regardless of their choice, we are done waiting for a state change.
					if (disposable) {
						disposable.dispose();
					}
				});
			}, seconds * 1000);

			// Listen for state changes.
			disposable = session.onDidChangeRuntimeState(state => {
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

	private generateNewSessionId(metadata: ILanguageRuntimeMetadata): string {
		// Generate a random session ID. We use fairly short IDs to make them more readable.
		const id = `${metadata.languageId}-${Math.random().toString(16).slice(2, 10)}`;

		// Since the IDs are short, there's a chance of collision. If we have a collision, try again.
		if (this._activeSessionsBySessionId.has(id)) {
			return this.generateNewSessionId(metadata);
		}

		return id;
	}

	/**
	 * Starts a UI client instance for the specified runtime session. The
	 * UI client instance is used for two-way communication of
	 * global state and events between the frontend and the backend.
	 *
	 * @param session The runtime session for which to start the UI client.
	 */
	private startUiClient(session: ILanguageRuntimeSession): void {
		// Create the frontend client. The second argument is empty for now; we
		// could use this to pass in any initial state we want to pass to the
		// frontend client (such as information on window geometry, etc.)
		session.createClient<IUiClientMessageInput, IUiClientMessageOutput>
			(RuntimeClientType.Ui, {}).then(client => {
				// Create the UI client instance wrapping the client instance.
				const uiClient = new UiClientInstance(client);
				this._register(uiClient);

				// When the UI client instance emits an event, broadcast
				// it to Positron with the corresponding runtime ID.
				this._register(uiClient.onDidBusy(event => {
					this._onDidReceiveRuntimeEventEmitter.fire({
						session_id: session.sessionId,
						event: {
							name: UiFrontendEvent.Busy,
							data: event
						}
					});
				}));
				this._register(uiClient.onDidClearConsole(event => {
					this._onDidReceiveRuntimeEventEmitter.fire({
						session_id: session.sessionId,
						event: {
							name: UiFrontendEvent.ClearConsole,
							data: event
						}
					});
				}));
				this._register(uiClient.onDidOpenEditor(event => {
					this._onDidReceiveRuntimeEventEmitter.fire({
						session_id: session.sessionId,
						event: {
							name: UiFrontendEvent.OpenEditor,
							data: event
						}
					});
				}));
				this._register(uiClient.onDidShowMessage(event => {
					this._onDidReceiveRuntimeEventEmitter.fire({
						session_id: session.sessionId,
						event: {
							name: UiFrontendEvent.ShowMessage,
							data: event
						}
					});
				}));
				this._register(uiClient.onDidPromptState(event => {
					this._onDidReceiveRuntimeEventEmitter.fire({
						session_id: session.sessionId,
						event: {
							name: UiFrontendEvent.PromptState,
							data: event
						}
					});
				}));
				this._register(uiClient.onDidWorkingDirectory(event => {
					this._onDidReceiveRuntimeEventEmitter.fire({
						session_id: session.sessionId,
						event: {
							name: UiFrontendEvent.WorkingDirectory,
							data: event
						}
					});
				}));
			});
	}

}

registerSingleton(IRuntimeSessionService, RuntimeSessionService, InstantiationType.Eager);
