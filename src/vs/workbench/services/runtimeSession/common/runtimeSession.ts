/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { DeferredPromise, disposableTimeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IOpener, IOpenerService, OpenExternalOptions, OpenInternalOptions } from '../../../../platform/opener/common/opener.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeExitReason, RuntimeState, formatLanguageRuntimeMetadata, formatLanguageRuntimeSession } from '../../languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeGlobalEvent, ILanguageRuntimeSession, ILanguageRuntimeSessionManager, ILanguageRuntimeSessionStateEvent, IRuntimeSessionMetadata, IRuntimeSessionService, IRuntimeSessionWillStartEvent, RuntimeStartMode } from './runtimeSessionService.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IModalDialogPromptInstance, IPositronModalDialogsService } from '../../positronModalDialogs/common/positronModalDialogs.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { IExtensionService } from '../../extensions/common/extensions.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ActiveRuntimeSession } from './activeRuntimeSession.js';

/**
 * Get a map key corresponding to a session.
 *
 * @returns A composite of the session mode, runtime ID, and notebook URI - assuming that there
 *  is at most one session for this combination at any given time.
 */
function getSessionMapKey(sessionMode: LanguageRuntimeSessionMode,
	runtimeId: string,
	notebookUri: URI | undefined): string {
	return JSON.stringify([sessionMode, runtimeId, notebookUri?.toString()]);
}

/**
 * The implementation of IRuntimeSessionService.
 */
export class RuntimeSessionService extends Disposable implements IRuntimeSessionService, IOpener {

	// Needed for service branding in dependency injector.
	declare readonly _serviceBrand: undefined;

	// The session managers.
	private _sessionManagers: Array<ILanguageRuntimeSessionManager> = [];

	// The set of encountered languages. This is keyed by the languageId and is
	// used to orchestrate implicit runtime startup.
	private readonly _encounteredLanguagesByLanguageId = new Set<string>();

	/**
	 * The foreground session. This is the session that is currently active in
	 * the Console view.
	 */
	private _foregroundSession?: ILanguageRuntimeSession;

	// A map of the currently active sessions. This is keyed by the session ID.
	private readonly _activeSessionsBySessionId = new Map<string, ActiveRuntimeSession>();

	// A map of the starting consoles. This is keyed by the languageId
	// (metadata.languageId) of the runtime owning the session.
	private readonly _startingConsolesByLanguageId = new Map<string, ILanguageRuntimeMetadata>();

	// A map of the starting notebooks. This is keyed by the notebook URI
	// owning the session.
	private readonly _startingNotebooksByNotebookUri = new ResourceMap<ILanguageRuntimeMetadata>();

	// A map of sessions currently starting to promises that resolve when the session
	// is ready to use. This is keyed by the composition of the session mode, runtime ID,
	// and notebook URI.
	private readonly _startingSessionsBySessionMapKey = new Map<string, DeferredPromise<string>>();

	// A map of sessions currently shutting down to promises that resolve when the session
	// has shut down. This is keyed by the session ID.
	private readonly _shuttingDownRuntimesBySessionId = new Map<string, Promise<void>>();

	// A map of the currently active console sessions. Since we can currently
	// only have one console session per language, this is keyed by the
	// languageId (metadata.languageId) of the session.
	private readonly _consoleSessionsByLanguageId = new Map<string, ILanguageRuntimeSession>();

	// A map of the currently active notebook sessions. This is keyed by the notebook URI
	// owning the session.
	private readonly _notebookSessionsByNotebookUri = new ResourceMap<ILanguageRuntimeSession>();

	// An map of sessions that have been disconnected from the extension host,
	// from ID to session. We keep these around so we can reconnect them when
	// the extension host comes back online.
	private readonly _disconnectedSessions = new Map<string, ILanguageRuntimeSession>();

	// The event emitter for the onWillStartRuntime event.
	private readonly _onWillStartRuntimeEmitter =
		this._register(new Emitter<IRuntimeSessionWillStartEvent>);

	// The event emitter for the onDidStartRuntime event.
	private readonly _onDidStartRuntimeEmitter =
		this._register(new Emitter<ILanguageRuntimeSession>);

	// The event emitter for the onDidFailStartRuntime event.
	private readonly _onDidFailStartRuntimeEmitter =
		this._register(new Emitter<ILanguageRuntimeSession>);

	// The event emitter for the onDidChangeRuntimeState event.
	private readonly _onDidChangeRuntimeStateEmitter =
		this._register(new Emitter<ILanguageRuntimeSessionStateEvent>());

	// The event emitter for the onDidReceiveRuntimeEvent event.
	private readonly _onDidReceiveRuntimeEventEmitter =
		this._register(new Emitter<ILanguageRuntimeGlobalEvent>());

	// The event emitter for the onDidChangeForegroundSession event.
	private readonly _onDidChangeForegroundSessionEmitter =
		this._register(new Emitter<ILanguageRuntimeSession | undefined>);

	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@ILogService private readonly _logService: ILogService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IPositronModalDialogsService private readonly _positronModalDialogsService: IPositronModalDialogsService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IStorageService private readonly _storageService: IStorageService) {

		super();

		// Register as an opener in the opener service.
		this._openerService.registerOpener(this);

		// Add the onDidEncounterLanguage event handler.
		this._register(this._languageService.onDidRequestRichLanguageFeatures(languageId => {
			// Add the language to the set of encountered languages.
			this._encounteredLanguagesByLanguageId.add(languageId);

			// If a runtime for the language is already starting or running,
			// there is no need to check for implicit startup below.
			if (this.hasStartingOrRunningConsole(languageId)) {
				return;
			}

			// Find the registered runtimes for the language that have implicit
			// startup behavior. If there aren't any, return.
			const languageRuntimeInfos = this._languageRuntimeService.registeredRuntimes
				.filter(
					metadata =>
						metadata.languageId === languageId &&
						metadata.startupBehavior === LanguageRuntimeStartupBehavior.Implicit);
			if (!languageRuntimeInfos.length) {
				return;
			}

			// Start the first runtime that was found. This isn't random; the
			// runtimes are sorted by priority when registered by the extension
			// so they will be in the right order so the first one is the right
			// one to start.
			this._logService.trace(`Language runtime ${formatLanguageRuntimeMetadata(languageRuntimeInfos[0])} automatically starting`);
			this.autoStartRuntime(languageRuntimeInfos[0],
				`A file with the language ID ${languageId} was opened.`);
		}));

		// When an extension activates, check to see if we have any disconnected
		// sessions owned by that extension. If we do, try to reconnect them.
		this._register(this._extensionService.onDidChangeExtensionsStatus((e) => {
			for (const extensionId of e) {
				for (const session of this._disconnectedSessions.values()) {
					if (session.runtimeMetadata.extensionId.value === extensionId.value) {
						// Remove the session from the disconnected sessions so we don't
						// try to reconnect it again (no matter the outcome below)
						this._disconnectedSessions.delete(session.sessionId);

						// Attempt to reconnect the session.
						this._logService.debug(`Extension ${extensionId.value} has been reloaded; ` +
							`attempting to reconnect session ${session.sessionId}`);
						this.restoreRuntimeSession(session.runtimeMetadata, session.metadata);
					}
				}
			}
		}));

		// Changing the application storage scope causes disconnected sessions
		// to become unusable, since the information needed to reconnect to them
		// is stored in the old scope.
		this._register(this._storageService.onDidChangeTarget((e) => {
			if (e.scope === StorageScope.APPLICATION && this._disconnectedSessions.size > 0) {
				this._logService.debug(`Application storage scope changed; ` +
					`discarding ${this._disconnectedSessions.size} disconnected sessions`);
				this._disconnectedSessions.clear();
			}
		}));
	}

	//#region ILanguageRuntimeService Implementation

	// An event that fires when a runtime is about to start.
	readonly onWillStartSession = this._onWillStartRuntimeEmitter.event;

	// An event that fires when a runtime successfully starts.
	readonly onDidStartRuntime = this._onDidStartRuntimeEmitter.event;

	// An event that fires when a runtime fails to start.
	readonly onDidFailStartRuntime = this._onDidFailStartRuntimeEmitter.event;

	// An event that fires when a runtime changes state.
	readonly onDidChangeRuntimeState = this._onDidChangeRuntimeStateEmitter.event;

	// An event that fires when a runtime receives a global event.
	readonly onDidReceiveRuntimeEvent = this._onDidReceiveRuntimeEventEmitter.event;

	// An event that fires when the active runtime changes.
	readonly onDidChangeForegroundSession = this._onDidChangeForegroundSessionEmitter.event;

	/**
	 * Registers a session manager with the service.
	 *
	 * @param manager The session manager to register
	 * @returns A Disposable that can be used to unregister the session manager.
	 */
	registerSessionManager(manager: ILanguageRuntimeSessionManager): IDisposable {
		this._sessionManagers.push(manager);
		return toDisposable(() => {
			const index = this._sessionManagers.indexOf(manager);
			if (index !== -1) {
				this._sessionManagers.splice(index, 1);
			}
		});
	}

	/**
	 * Gets the console session for a runtime, if one exists. Used by the top
	 * bar interpreter drop-down to associated a session with a runtime.
	 *
	 * @param runtimeId The runtime identifier of the session to retrieve.
	 * @returns The console session with the given runtime identifier, or undefined if
	 *  no console session with the given runtime identifier exists.
	 */
	getConsoleSessionForRuntime(runtimeId: string): ILanguageRuntimeSession | undefined {
		// It's possible that there are multiple consoles for the same runtime,
		// for example, if one failed to start and is uninitialized. In that case,
		// we return the most recently created.
		return Array.from(this._activeSessionsBySessionId.values())
			.map((info, index) => ({ info, index }))
			.sort((a, b) =>
				b.info.session.metadata.createdTimestamp - a.info.session.metadata.createdTimestamp
				// If the timestamps are the same, prefer the session that was inserted last.
				|| b.index - a.index)
			.find(({ info }) =>
				info.session.runtimeMetadata.runtimeId === runtimeId &&
				info.session.metadata.sessionMode === LanguageRuntimeSessionMode.Console &&
				info.state !== RuntimeState.Exited)
			?.info.session;
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
	 * Gets the notebook session for a notebook URI, if one exists.
	 *
	 * @param notebookUri The notebook URI of the session to retrieve.
	 * @returns The notebook session with the given notebook URI, or undefined if
	 *  no notebook session with the given notebook URI exists.
	 */
	getNotebookSessionForNotebookUri(notebookUri: URI): ILanguageRuntimeSession | undefined {
		const session = this._notebookSessionsByNotebookUri.get(notebookUri);
		this._logService.info(`Lookup notebook session for notebook URI ${notebookUri.toString()}: ${session ? session.metadata.sessionId : 'not found'}`);
		return this._notebookSessionsByNotebookUri.get(notebookUri);
	}

	/**
	 * Selects and starts a new runtime session, after shutting down any currently active
	 * sessions for the language.
	 *
	 * @param runtimeId The ID of the runtime to select
	 * @param source The source of the selection
	 *
	 * @returns A promise that resolves to the session ID when the runtime is started
	 */
	async selectRuntime(runtimeId: string, source: string): Promise<void> {
		const runtime = this._languageRuntimeService.getRegisteredRuntime(runtimeId);
		if (!runtime) {
			throw new Error(`No language runtime with id '${runtimeId}' was found.`);
		}

		// Shut down any other runtime consoles for the language.
		const activeSession =
			this.getConsoleSessionForLanguage(runtime.languageId);
		if (activeSession) {
			// Is this, by chance, the runtime that's already running?
			if (activeSession.runtimeMetadata.runtimeId === runtime.runtimeId) {
				// Set it as the foreground session and return.
				this.foregroundSession = activeSession;
				return;
			}

			await this.shutdownRuntimeSession(activeSession, RuntimeExitReason.SwitchRuntime);
		}

		// Wait for the selected runtime to start.
		await this.startNewRuntimeSession(runtime.runtimeId,
			runtime.runtimeName,
			LanguageRuntimeSessionMode.Console,
			undefined, // No notebook URI (console session)
			source,
			RuntimeStartMode.Switching);
	}

	/**
	 * Shutdown a runtime session.
	 *
	 * @param session The session to shutdown.
	 * @param exitReason The reason for shutting down the session.
	 * @returns Promise that resolves when the session has been shutdown.
	 */
	private async shutdownRuntimeSession(
		session: ILanguageRuntimeSession, exitReason: RuntimeExitReason): Promise<void> {
		// See if we are already shutting down this session. If we
		// are, return the promise that resolves when the runtime is shut down.
		// This makes it possible for multiple requests to shut down the same
		// session to be coalesced.
		const sessionId = session.metadata.sessionId;
		const shuttingDownPromise = this._shuttingDownRuntimesBySessionId.get(sessionId);
		if (shuttingDownPromise) {
			return shuttingDownPromise;
		}
		const shutdownPromise = this.doShutdownRuntimeSession(session, exitReason)
			.finally(() => this._shuttingDownRuntimesBySessionId.delete(sessionId));

		this._shuttingDownRuntimesBySessionId.set(sessionId, shutdownPromise);

		return shutdownPromise;
	}

	private async doShutdownRuntimeSession(
		session: ILanguageRuntimeSession, exitReason: RuntimeExitReason): Promise<void> {

		const activeSession = this._activeSessionsBySessionId.get(session.sessionId);
		if (!activeSession) {
			throw new Error(`No active session '${session.sessionId}'`);
		}

		// We wait for `onDidEndSession()` rather than `RuntimeState.Exited`, because the former
		// generates some Console output that must finish before starting up a new runtime:
		const disposables = new DisposableStore();
		activeSession.register(disposables);
		const promise = new Promise<void>((resolve, reject) => {
			disposables.add(session.onDidEndSession((exit) => {
				disposables.dispose();
				resolve();
			}));
			disposables.add(disposableTimeout(() => {
				disposables.dispose();
				reject(new Error(`Timed out waiting for runtime ` +
					`${formatLanguageRuntimeSession(session)} to finish exiting.`));
			}, 5000));
		});

		// Ask the runtime to shut down.
		try {
			await session.shutdown(exitReason);
		} catch (error) {
			disposables.dispose();
			throw error;
		}

		// Wait for the runtime onDidEndSession to resolve, or for the timeout to expire
		// (whichever comes first)
		await promise;
	}

	/**
	 * Starts a new runtime session.
	 *
	 * @param runtimeId The runtime identifier of the runtime.
	 * @param sessionName A human readable name for the session.
	 * @param sessionMode The mode of the new session.
	 * @param notebookUri The notebook URI to attach to the session, if any.
	 * @param source The source of the request to start the runtime.
	 * @param startMode The mode in which to start the runtime.
	 */
	async startNewRuntimeSession(runtimeId: string,
		sessionName: string,
		sessionMode: LanguageRuntimeSessionMode,
		notebookUri: URI | undefined,
		source: string,
		startMode = RuntimeStartMode.Starting): Promise<string> {
		// See if we are already starting the requested session. If we
		// are, return the promise that resolves when the session is ready to
		// use. This makes it possible for multiple requests to start the same
		// session to be coalesced.
		const startingRuntimePromise = this._startingSessionsBySessionMapKey.get(
			getSessionMapKey(sessionMode, runtimeId, notebookUri));
		if (startingRuntimePromise && !startingRuntimePromise.isSettled) {
			return startingRuntimePromise.p;
		}

		// Get the runtime. Throw an error, if it could not be found.
		const languageRuntime = this._languageRuntimeService.getRegisteredRuntime(runtimeId);
		if (!languageRuntime) {
			throw new Error(`No language runtime with id '${runtimeId}' was found.`);
		}

		const runningSessionId = this.validateRuntimeSessionStart(sessionMode, languageRuntime, notebookUri, source);
		if (runningSessionId) {
			return runningSessionId;
		}

		// If the workspace is not trusted, defer starting the runtime until the
		// workspace is trusted.
		if (!this._workspaceTrustManagementService.isWorkspaceTrusted()) {
			if (sessionMode === LanguageRuntimeSessionMode.Console) {
				return this.autoStartRuntime(languageRuntime, source, startMode);
			} else {
				throw new Error(`Cannot start a ${sessionMode} session in an untrusted workspace.`);
			}
		}

		// Start the runtime.
		this._logService.info(
			`Starting session for language runtime ` +
			`${formatLanguageRuntimeMetadata(languageRuntime)} (Source: ${source})`);
		return this.doCreateRuntimeSession(languageRuntime, sessionName, sessionMode, source, startMode, notebookUri);
	}

	/**
	 * Validates that a runtime session can be restored.
	 *
	 * @param runtimeMetadata
	 * @param sessionId
	 */
	async validateRuntimeSession(
		runtimeMetadata: ILanguageRuntimeMetadata,
		sessionId: string): Promise<boolean> {

		// Get the runtime's manager.
		let sessionManager: ILanguageRuntimeSessionManager;
		try {
			sessionManager = await this.getManagerForRuntime(runtimeMetadata);
		} catch (err) {
			// This shouldn't happen, but could in unusual circumstances, e.g.
			// the extension that supplies the runtime was uninstalled and this
			// is a stale session that it owned the last time we were running.
			this._logService.error(`Error getting manager for runtime ${formatLanguageRuntimeMetadata(runtimeMetadata)}: ${err}`);
			// Treat the session as invalid if we can't get the manager.
			return false;
		}

		return sessionManager.validateSession(sessionId);
	}

	/**
	 * Restores (reconnects to) a runtime session that was previously started.
	 *
	 * @param runtimeMetadata The metadata of the runtime to start.
	 * @param sessionMetadata The metadata of the session to start.
	 */
	async restoreRuntimeSession(
		runtimeMetadata: ILanguageRuntimeMetadata,
		sessionMetadata: IRuntimeSessionMetadata): Promise<void> {

		// See if we are already starting the requested session. If we
		// are, return the promise that resolves when the session is ready to
		// use. This makes it possible for multiple requests to start the same
		// session to be coalesced.
		const startingRuntimePromise = this._startingSessionsBySessionMapKey.get(
			getSessionMapKey(sessionMetadata.sessionMode, runtimeMetadata.runtimeId, sessionMetadata.notebookUri));
		if (startingRuntimePromise && !startingRuntimePromise.isSettled) {
			return startingRuntimePromise.p.then(() => { });
		}

		// Ensure that the runtime is registered.
		const languageRuntime = this._languageRuntimeService.getRegisteredRuntime(
			runtimeMetadata.runtimeId);
		if (!languageRuntime) {
			this._logService.debug(`[Reconnect ${sessionMetadata.sessionId}]: ` +
				`Registering runtime ${runtimeMetadata.runtimeName}`);
			this._languageRuntimeService.registerRuntime(runtimeMetadata);
		}

		const runningSessionId = this.validateRuntimeSessionStart(
			sessionMetadata.sessionMode, runtimeMetadata, sessionMetadata.notebookUri);
		if (runningSessionId) {
			return;
		}

		// Create a promise that resolves when the runtime is ready to use.
		const startPromise = new DeferredPromise<string>();
		const sessionMapKey = getSessionMapKey(
			sessionMetadata.sessionMode, runtimeMetadata.runtimeId, sessionMetadata.notebookUri);
		this._startingSessionsBySessionMapKey.set(sessionMapKey, startPromise);

		// It's possible that startPromise is never awaited, so we log any errors here
		// at the debug level since we still expect the error to be handled/logged elsewhere.
		startPromise.p.catch((err) => this._logService.debug(`Error starting session: ${err}`));

		this.setStartingSessionMaps(
			sessionMetadata.sessionMode, runtimeMetadata, sessionMetadata.notebookUri);

		// We should already have a session manager registered, since we can't
		// get here until the extension host has been activated.
		if (this._sessionManagers.length === 0) {
			throw new Error(`No session manager has been registered.`);
		}

		// Get the runtime's manager.
		let sessionManager: ILanguageRuntimeSessionManager;
		try {
			sessionManager = await this.getManagerForRuntime(runtimeMetadata);
		} catch (err) {
			startPromise.error(err);
			this.clearStartingSessionMaps(
				sessionMetadata.sessionMode, runtimeMetadata, sessionMetadata.notebookUri);
			throw err;
		}

		// Restore the session. This can take some time; it may involve waiting
		// for the extension to finish activating and the network to attempt to
		// reconnect, etc.
		let session: ILanguageRuntimeSession;
		try {
			session = await sessionManager.restoreSession(runtimeMetadata, sessionMetadata);
		} catch (err) {
			this._logService.error(
				`Reconnecting to session '${sessionMetadata.sessionId}' for language runtime ` +
				`${formatLanguageRuntimeMetadata(runtimeMetadata)} failed. Reason: ${err}`);
			startPromise.error(err);
			this.clearStartingSessionMaps(
				sessionMetadata.sessionMode, runtimeMetadata, sessionMetadata.notebookUri);
			throw err;
		}

		// Actually reconnect the session.
		try {
			await this.doStartRuntimeSession(session, sessionManager, RuntimeStartMode.Reconnecting);
			startPromise.complete(sessionMetadata.sessionId);
		} catch (err) {
			startPromise.error(err);
		}

		return startPromise.p.then(() => { });
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

		// Fire the onDidChangeForegroundSession event.
		this._onDidChangeForegroundSessionEmitter.fire(this._foregroundSession);
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
	 * @param sessionId The session ID of the runtime to restart.
	 * @param source The source of the request to restart the runtime.
	 */
	async restartSession(sessionId: string, source: string): Promise<void> {
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
	hasStartingOrRunningConsole(languageId?: string | undefined) {
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
	 * @param startMode The mode in which to start the runtime.
	 *
	 * @returns A promise that resolves with a session ID for the new session,
	 * if one was started.
	 */
	async autoStartRuntime(
		metadata: ILanguageRuntimeMetadata,
		source: string,
		startMode = RuntimeStartMode.Starting,
	): Promise<string> {
		// Check the setting to see if we should be auto-starting.
		const autoStart = this._configurationService.getValue<boolean>(
			'interpreters.automaticStartup');
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

			return this.doAutoStartRuntime(metadata, source, startMode);
		} else {
			this._logService.debug(`Deferring the start of language runtime ` +
				`${formatLanguageRuntimeMetadata(metadata)} (Source: ${source}) ` +
				`because workspace trust has not been granted. ` +
				`The runtime will be started when workspace trust is granted.`);
			const disposable = this._register(this._workspaceTrustManagementService.onDidChangeTrust((trusted) => {
				if (!trusted) {
					// If the workspace is still not trusted, do nothing.
					return;
				}
				// If the workspace is trusted, start the runtime.
				disposable.dispose();
				this._logService.info(`Language runtime ` +
					`${formatLanguageRuntimeMetadata(metadata)} ` +
					`automatically starting after workspace trust was granted. ` +
					`Source: ${source}`);
				this.doAutoStartRuntime(metadata, source, startMode);
			}));
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
	 * Automatically starts a runtime. Does not perform any checks to see if
	 * auto-start is enabled or trust is granted; call autoStartRuntime()
	 * instead if you need those checks.
	 *
	 * @param metadata The metadata for the runtime to start.
	 * @param source The source of the request to start the runtime.
	 * @param startMode The mode in which to start the runtime.
	 */
	private async doAutoStartRuntime(
		metadata: ILanguageRuntimeMetadata,
		source: string,
		startMode: RuntimeStartMode): Promise<string> {

		// Auto-started runtimes are (currently) always console sessions.
		const sessionMode = LanguageRuntimeSessionMode.Console;
		const notebookUri = undefined;

		// See if we are already starting the requested session. If we
		// are, return the promise that resolves when the session is ready to
		// use. This makes it possible for multiple requests to start the same
		// session to be coalesced.
		const startingRuntimePromise = this._startingSessionsBySessionMapKey.get(
			getSessionMapKey(sessionMode, metadata.runtimeId, notebookUri));
		if (startingRuntimePromise && !startingRuntimePromise.isSettled) {
			return startingRuntimePromise.p;
		}

		const runningSessionId = this.validateRuntimeSessionStart(sessionMode, metadata, notebookUri, source);
		if (runningSessionId) {
			return runningSessionId;
		}

		// Before attempting to validate the runtime, add it to the set of
		// starting consoles.
		this._startingConsolesByLanguageId.set(metadata.languageId, metadata);

		// Create a promise that resolves when the runtime is ready to use.
		const startPromise = new DeferredPromise<string>();
		const sessionMapKey = getSessionMapKey(sessionMode, metadata.runtimeId, notebookUri);
		this._startingSessionsBySessionMapKey.set(sessionMapKey, startPromise);

		// It's possible that startPromise is never awaited, so we log any errors here
		// at the debug level since we still expect the error to be handled/logged elsewhere.
		startPromise.p.catch(err => this._logService.debug(`Error starting runtime session: ${err}`));

		// Get the runtime's manager.
		let sessionManager: ILanguageRuntimeSessionManager;
		try {
			sessionManager = await this.getManagerForRuntime(metadata);
		} catch (err) {
			startPromise.error(err);
			this.clearStartingSessionMaps(sessionMode, metadata, notebookUri);
			throw err;
		}

		// Check to see if the runtime has already been registered with the
		// language runtime service.
		const languageRuntime =
			this._languageRuntimeService.getRegisteredRuntime(metadata.runtimeId);

		// If it has not been registered, validate the metadata.
		if (!languageRuntime) {
			try {
				// Attempt to validate the metadata. Note that this can throw if the metadata
				// is invalid!
				const validated = await sessionManager.validateMetadata(metadata);

				// Did the validator change the runtime ID? If so, we're starting a different
				// runtime than the one that we were asked for.
				//
				// This isn't unexpected but deserves some logging.
				if (validated.runtimeId !== metadata.runtimeId) {
					if (!metadata.runtimeId) {
						// We've leveraged validateMetadata to swap the partially hydrated metadata
						// for the fully hydrated metadata.
						this._logService.info(
							`Hydrated metadata for runtime ${formatLanguageRuntimeMetadata(validated)}`
						);
					} else {
						// The runtime ID changed.
						const existing =
							this._languageRuntimeService.getRegisteredRuntime(validated.runtimeId);
						if (existing) {
							// This should shouldn't happen, but warn if it does.
							this._logService.warn(
								`Language runtime ${formatLanguageRuntimeMetadata(validated)} ` +
								`already registered; re-registering.`);
						} else {
							this._logService.info(
								`Replacing runtime ${formatLanguageRuntimeMetadata(metadata)} => `
								+ `${formatLanguageRuntimeMetadata(validated)}`);
						}
					}
				}

				// Register the newly validated runtime.
				this._languageRuntimeService.registerRuntime(validated);

				// Replace the metadata we were given with the validated metadata.
				metadata = validated;
				this._startingConsolesByLanguageId.set(metadata.languageId, validated);

			} catch (err) {
				// Clear this from the set of starting consoles.
				this._startingConsolesByLanguageId.delete(metadata.languageId);

				// Log the error and re-throw it.
				this._logService.error(
					`Language runtime ${formatLanguageRuntimeMetadata(metadata)} ` +
					`could not be validated. Reason: ${err}`);
				throw err;
			}
		}

		return this.doCreateRuntimeSession(metadata, metadata.runtimeName, sessionMode, source, startMode, notebookUri);
	}

	/**
	 * Creates and starts a runtime session.
	 *
	 * @param runtimeMetadata The metadata for the runtime to start.
	 * @param sessionName A human-readable name for the session.
	 * @param sessionMode The mode for the new session.
	 * @param source The source of the request to start the runtime.
	 * @param startMode The mode in which to start the runtime.
	 * @param notebookDocument The notebook document to attach to the session, if any.
	 *
	 * Returns a promise that resolves with the session ID when the runtime is
	 * ready to use.
	 */
	private async doCreateRuntimeSession(runtimeMetadata: ILanguageRuntimeMetadata,
		sessionName: string,
		sessionMode: LanguageRuntimeSessionMode,
		source: string,
		startMode: RuntimeStartMode,
		notebookUri?: URI): Promise<string> {
		this.setStartingSessionMaps(sessionMode, runtimeMetadata, notebookUri);

		// Create a promise that resolves when the runtime is ready to use, if there isn't already one.
		const sessionMapKey = getSessionMapKey(sessionMode, runtimeMetadata.runtimeId, notebookUri);
		let startPromise = this._startingSessionsBySessionMapKey.get(sessionMapKey);
		if (!startPromise || startPromise.isSettled) {
			startPromise = new DeferredPromise<string>();
			this._startingSessionsBySessionMapKey.set(sessionMapKey, startPromise);

			// It's possible that startPromise is never awaited, so we log any errors here
			// at the debug level since we still expect the error to be handled/logged elsewhere.
			startPromise.p.catch(err => this._logService.debug(`Error starting runtime session: ${err}`));
		}

		// Get the runtime's manager.
		let sessionManager: ILanguageRuntimeSessionManager;
		try {
			sessionManager = await this.getManagerForRuntime(runtimeMetadata);
		} catch (err) {
			startPromise.error(err);
			this.clearStartingSessionMaps(sessionMode, runtimeMetadata, notebookUri);
			throw err;
		}

		const sessionId = this.generateNewSessionId(runtimeMetadata);
		const sessionMetadata: IRuntimeSessionMetadata = {
			sessionId,
			sessionName,
			sessionMode,
			notebookUri,
			createdTimestamp: Date.now(),
			startReason: source
		};

		// Provision the new session.
		let session: ILanguageRuntimeSession;
		try {
			session = await sessionManager.createSession(runtimeMetadata, sessionMetadata);
		} catch (err) {
			this._logService.error(
				`Creating session for language runtime ` +
				`${formatLanguageRuntimeMetadata(runtimeMetadata)} failed. Reason: ${err}`);
			startPromise.error(err);
			this.clearStartingSessionMaps(sessionMode, runtimeMetadata, notebookUri);

			// Re-throw the error.
			throw err;
		}

		// Actually start the session.
		try {
			await this.doStartRuntimeSession(session, sessionManager, startMode);
			startPromise.complete(sessionId);
		} catch (err) {
			startPromise.error(err);
		}

		return startPromise.p;
	}

	/**
	 * Internal method to start a runtime session.
	 *
	 * @param session The session to start.
	 * @param manager The session manager for the session.
	 * @param startMode The mode in which the session is starting.
	 */
	private async doStartRuntimeSession(session: ILanguageRuntimeSession,
		manager: ILanguageRuntimeSessionManager,
		startMode: RuntimeStartMode):
		Promise<void> {

		// Fire the onWillStartRuntime event.
		const evt: IRuntimeSessionWillStartEvent = {
			session,
			startMode,
		};
		this._onWillStartRuntimeEmitter.fire(evt);

		// Attach event handlers to the newly provisioned session.
		this.attachToSession(session, manager);

		try {
			// Attempt to start, or reconnect to, the session.
			await session.start();

			// The runtime started. Move it from the starting runtimes to the
			// running runtimes.
			this.clearStartingSessionMaps(
				session.metadata.sessionMode, session.runtimeMetadata, session.metadata.notebookUri);
			if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
				this._consoleSessionsByLanguageId.set(session.runtimeMetadata.languageId, session);
			} else if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Notebook) {
				if (session.metadata.notebookUri) {
					this._logService.info(`Notebook session for ${session.metadata.notebookUri} started: ${session.metadata.sessionId}`);
					this._notebookSessionsByNotebookUri.set(session.metadata.notebookUri, session);
				} else {
					this._logService.error(`Notebook session ${formatLanguageRuntimeSession(session)} ` +
						`does not have a notebook URI.`);
				}
			}

			// Fire the onDidStartRuntime event.
			this._onDidStartRuntimeEmitter.fire(session);

			// Make the newly-started runtime the foreground runtime if it's a console session.
			if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
				this._foregroundSession = session;
			}
		} catch (reason) {
			this.clearStartingSessionMaps(
				session.metadata.sessionMode, session.runtimeMetadata, session.metadata.notebookUri);

			// Fire the onDidFailStartRuntime event.
			this._onDidFailStartRuntimeEmitter.fire(session);

			this._logService.error(`Starting language runtime failed. Reason: ${reason}`);

			// Rethrow the error.
			throw reason;
		}
	}

	/**
	 * Gets the session manager that manages the runtime with the given runtime ID.
	 *
	 * @param runtime The runtime to get the manager for.
	 * @returns The session manager that manages the runtime.
	 *
	 * Throws an errror if no session manager is found for the runtime.
	 */
	private async getManagerForRuntime(runtime: ILanguageRuntimeMetadata): Promise<ILanguageRuntimeSessionManager> {
		// Look for the session manager that manages the runtime.
		for (const manager of this._sessionManagers) {
			if (await manager.managesRuntime(runtime)) {
				return manager;
			}
		}
		throw new Error(`No session manager found for runtime ` +
			`${formatLanguageRuntimeMetadata(runtime)} ` +
			`(${this._sessionManagers.length} managers registered).`);
	}

	/**
	 * Attaches event handlers and registers a freshly created language runtime
	 * session with the service.
	 *
	 * @param session The session to attach.
	 * @param manager The session's manager.
	 */
	private attachToSession(session: ILanguageRuntimeSession,
		manager: ILanguageRuntimeSessionManager): void {

		// Clean up any previous active session info for this session.
		const oldSession = this._activeSessionsBySessionId.get(session.sessionId);
		if (oldSession) {
			oldSession.dispose();
		}

		// Save the new active session info.
		const activeSession = new ActiveRuntimeSession(session, manager,
			this._commandService, this._logService, this._openerService, this._configurationService);
		this._activeSessionsBySessionId.set(session.sessionId, activeSession);
		this._register(activeSession);
		this._register(activeSession.onDidReceiveRuntimeEvent(evt => {
			this._onDidReceiveRuntimeEventEmitter.fire(evt);
		}));

		// Add the onDidChangeRuntimeState event handler.
		activeSession.register(session.onDidChangeRuntimeState(state => {
			// Process the state change.
			switch (state) {
				case RuntimeState.Ready:
					if (session !== this._foregroundSession &&
						session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
						// When a new console is ready, activate it. We avoid
						// re-activation if already active since the resulting
						// events can cause Positron behave as though a new
						// runtime were started (e.g. focusing the console)
						this.foregroundSession = session;
					}

					// Restore the session in the case of a restart.
					if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console &&
						!this._consoleSessionsByLanguageId.has(session.runtimeMetadata.languageId)) {
						this._consoleSessionsByLanguageId.set(session.runtimeMetadata.languageId,
							session);
					} else if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Notebook &&
						session.metadata.notebookUri &&
						!this._notebookSessionsByNotebookUri.has(session.metadata.notebookUri)) {
						this._notebookSessionsByNotebookUri.set(session.metadata.notebookUri, session);
					}

					// Start the UI client instance once the runtime is fully online.
					activeSession.startUiClient().then((clientId) => {
						this._logService.debug(`UI client ${clientId} bound to session ${session.sessionId}`);
					});
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

				case RuntimeState.Starting:
					// If the runtime is restarting (i.e. starting from the exited state),
					// fire the onWillStartRuntime event.
					if (activeSession.state === RuntimeState.Exited) {
						this._onWillStartRuntimeEmitter.fire({
							session,
							startMode: RuntimeStartMode.Restarting,
						});
					}
					break;

				case RuntimeState.Exited:
					this.updateSessionMapsAfterExit(session);
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

		activeSession.register(session.onDidEndSession(async exit => {
			this.updateSessionMapsAfterExit(session);

			// Note that we need to do the following on the next tick since we
			// need to ensure all the event handlers for the state change we are
			// currently processing have been called (i.e. everyone knows it has
			// exited)
			setTimeout(() => {
				const sessionInfo = this._activeSessionsBySessionId.get(session.sessionId);
				if (!sessionInfo) {
					this._logService.error(
						`Session ${formatLanguageRuntimeSession(session)} is not active.`);
					return;
				}

				// If a workspace session ended because the extension host was
				// disconnected, remember it so we can attempt to reconnect it
				// when the extension host comes back online.
				if (exit.reason === RuntimeExitReason.ExtensionHost &&
					session.runtimeMetadata.sessionLocation ===
					LanguageRuntimeSessionLocation.Workspace) {
					this._disconnectedSessions.set(session.sessionId, session);
				}
			}, 0);
		}));
	}

	/**
	 * Validate whether a runtime session can be started.
	 *
	 * @param sessionMode The mode of the new session.
	 * @param languageRuntime The metadata of the runtime to start.
	 * @param notebookUri The notebook URI to attach to the session, if any.
	 * @param source The source of the request to start the runtime, if known.
	 * @throws An error if the session cannot be started.
	 * @returns A session ID if a session is already running that matches the request, or undefined.
	 */
	private validateRuntimeSessionStart(
		sessionMode: LanguageRuntimeSessionMode,
		languageRuntime: ILanguageRuntimeMetadata,
		notebookUri: URI | undefined,
		source?: string,
	): string | undefined {
		// If there is already a runtime starting for the language, throw an error.
		if (sessionMode === LanguageRuntimeSessionMode.Console) {
			const startingLanguageRuntime = this._startingConsolesByLanguageId.get(
				languageRuntime.languageId);
			if (startingLanguageRuntime) {
				throw new Error(`Session for language runtime ` +
					`${formatLanguageRuntimeMetadata(languageRuntime)} ` +
					`cannot be started because language runtime ` +
					`${formatLanguageRuntimeMetadata(startingLanguageRuntime)} ` +
					`is already starting for the language.` +
					(source ? ` Request source: ${source}` : ``));
			}

			// If there is already a runtime running for the language, throw an error.
			const runningLanguageRuntime =
				this._consoleSessionsByLanguageId.get(languageRuntime.languageId);
			if (runningLanguageRuntime) {
				const metadata = runningLanguageRuntime.runtimeMetadata;
				if (metadata.runtimeId === languageRuntime.runtimeId) {
					// If the runtime that is running is the one we were just asked
					// to start, we're technically in good shape since the runtime
					// is already running!
					return runningLanguageRuntime.sessionId;
				} else {
					throw new Error(`A console for ` +
						`${formatLanguageRuntimeMetadata(languageRuntime)} ` +
						`cannot be started because a console for ` +
						`${formatLanguageRuntimeMetadata(metadata)} is already running ` +
						`for the ${metadata.languageName} language.` +
						(source ? ` Request source: ${source}` : ``));
				}
			}
		} else if (sessionMode === LanguageRuntimeSessionMode.Notebook) {
			// If no notebook URI is provided, throw an error.
			if (!notebookUri) {
				throw new Error(`A notebook URI must be provided when starting a notebook session.`);
			}

			// If there is already a runtime starting for the notebook, throw an error.
			const startingLanguageRuntime = this._startingNotebooksByNotebookUri.get(notebookUri);
			if (startingLanguageRuntime) {
				throw new Error(`Session for language runtime ` +
					`${formatLanguageRuntimeMetadata(languageRuntime)} ` +
					`cannot be started because language runtime ` +
					`${formatLanguageRuntimeMetadata(startingLanguageRuntime)} ` +
					`is already starting for the notebook ${notebookUri.toString()}.` +
					(source ? ` Request source: ${source}` : ``));
			}

			// If there is already a runtime running for the notebook, throw an error.
			const runningLanguageRuntime = this._notebookSessionsByNotebookUri.get(notebookUri);
			if (runningLanguageRuntime) {
				const metadata = runningLanguageRuntime.runtimeMetadata;
				if (metadata.runtimeId === languageRuntime.runtimeId) {
					// If the runtime that is running is the one we were just asked
					// to start, we're technically in good shape since the runtime
					// is already running!
					return runningLanguageRuntime.sessionId;
				} else {
					throw new Error(`A notebook for ` +
						`${formatLanguageRuntimeMetadata(languageRuntime)} ` +
						`cannot be started because a notebook for ` +
						`${formatLanguageRuntimeMetadata(metadata)} is already running ` +
						`for the URI ${notebookUri.toString()}.` +
						(source ? ` Request source: ${source}` : ``));
				}
			}
		}

		return undefined;
	}

	/**
	 * Sets the session maps for a starting session.
	 *
	 * @param sessionMode The mode of the session.
	 * @param runtimeMetadata The metadata of the session's runtime.
	 * @param notebookUri The notebook URI attached to the session, if any.
	 */
	private setStartingSessionMaps(
		sessionMode: LanguageRuntimeSessionMode,
		runtimeMetadata: ILanguageRuntimeMetadata,
		notebookUri?: URI) {
		if (sessionMode === LanguageRuntimeSessionMode.Console) {
			this._startingConsolesByLanguageId.set(runtimeMetadata.languageId, runtimeMetadata);
		} else if (sessionMode === LanguageRuntimeSessionMode.Notebook && notebookUri) {
			this._startingNotebooksByNotebookUri.set(notebookUri, runtimeMetadata);
		}
	}

	/**
	 * Clears the session maps for a starting session.
	 *
	 * @param sessionMode The mode of the session.
	 * @param runtimeMetadata The metadata of the session's runtime.
	 * @param notebookUri The notebook URI attached to the session, if any.
	 */
	private clearStartingSessionMaps(
		sessionMode: LanguageRuntimeSessionMode,
		runtimeMetadata: ILanguageRuntimeMetadata,
		notebookUri?: URI) {
		const sessionMapKey = getSessionMapKey(sessionMode, runtimeMetadata.runtimeId, notebookUri);
		this._startingSessionsBySessionMapKey.delete(sessionMapKey);
		if (sessionMode === LanguageRuntimeSessionMode.Console) {
			this._startingConsolesByLanguageId.delete(runtimeMetadata.languageId);
		} else if (sessionMode === LanguageRuntimeSessionMode.Notebook && notebookUri) {
			this._startingNotebooksByNotebookUri.delete(notebookUri);
		}
	}

	/**
	 * Updates the session maps (for active consoles, notebooks, etc.), after a
	 * session exits.
	 *
	 * @param session The session to update.
	 */
	private updateSessionMapsAfterExit(session: ILanguageRuntimeSession) {
		if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
			// The session is no longer running, so if it's the active console
			// session, clear it.
			const consoleSession = this._consoleSessionsByLanguageId.get(session.runtimeMetadata.languageId);
			if (consoleSession?.sessionId === session.sessionId) {
				this._consoleSessionsByLanguageId.delete(session.runtimeMetadata.languageId);
			}
		} else if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Notebook) {
			if (session.metadata.notebookUri) {
				this._logService.info(`Notebook session for ${session.metadata.notebookUri} exited.`);
				this._notebookSessionsByNotebookUri.delete(session.metadata.notebookUri);
			} else {
				this._logService.error(`Notebook session ${formatLanguageRuntimeSession(session)} ` +
					`does not have a notebook URI.`);
			}
		}
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

			// Mark the session as starting until the restart sequence completes.
			this.setStartingSessionMaps(
				session.metadata.sessionMode, session.runtimeMetadata, session.metadata.notebookUri);
			const disposable = this._register(session.onDidChangeRuntimeState((state) => {
				if (state === RuntimeState.Ready) {
					disposable.dispose();
					this.clearStartingSessionMaps(
						session.metadata.sessionMode, session.runtimeMetadata, session.metadata.notebookUri);
				}
			}));

			// Restart the session.
			return session.restart();
		} else if (state === RuntimeState.Uninitialized ||
			state === RuntimeState.Exited) {
			// The runtime has never been started, or is no longer running. Just
			// tell it to start.
			await this.startNewRuntimeSession(session.runtimeMetadata.runtimeId,
				session.metadata.sessionName,
				session.metadata.sessionMode,
				session.metadata.notebookUri,
				`'Restart Interpreter' command invoked`);
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
				new Error(`The ${session.runtimeMetadata.languageName} session is '${state}' ` +
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
		const warning = nls.localize('positron.runtimeInterruptTimeoutWarning', "{0} isn't responding to your request to interrupt the command. Do you want to forcefully quit your {1} session? You'll lose any unsaved objects.", session.metadata.sessionName, session.runtimeMetadata.languageName);
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
		const warning = nls.localize('positron.runtimeShutdownTimeoutWarning', "{0} isn't responding to your request to shut down the session. Do you want use a forced quit to end your {1} session? You'll lose any unsaved objects.", session.metadata.sessionName, session.runtimeMetadata.languageName);
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
		const warning = nls.localize('positron.runtimeReconnectTimeoutWarning', "{0} has been offline for more than 30 seconds. Do you want to force quit your {1} session? You'll lose any unsaved objects.", session.metadata.sessionName, session.runtimeMetadata.languageName);
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

		const disposables = new DisposableStore();
		let prompt: IModalDialogPromptInstance | undefined = undefined;

		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				// We timed out; reject the promise.
				reject();

				// Show a prompt to the user asking if they want to force quit the runtime.
				prompt = this._positronModalDialogsService.showModalDialogPrompt(
					nls.localize('positron.runtimeNotResponding', "{0} is not responding", session.runtimeMetadata.runtimeName),
					warning,
					nls.localize('positron.runtimeForceQuit', "Force Quit"),
					nls.localize('positron.runtimeKeepWaiting', "Wait")
				);

				prompt.onChoice((choice) => {
					// If the user chose to force quit the runtime, do so.
					if (choice) {
						session.forceQuit();
					}
					// Regardless of their choice, we are done waiting for a state change.
					disposables.dispose();
				});
			}, seconds * 1000);

			// Runs when the requested state change was completed.
			const completeStateChange = () => {
				clearTimeout(timer);
				resolve();

				// If we were prompting the user to force quit the runtime,
				// close the prompt ourselves since the runtime is now
				// responding.
				if (prompt) {
					prompt.close();
				}
				disposables.dispose();
			};

			// Listen for state changes.
			disposables.add(session.onDidChangeRuntimeState(state => {
				if (targetStates.includes(state)) {
					completeStateChange();
				}
			}));

			// Listen for the session to end. This should be treated as an exit
			// for the purposes of waiting for the session to exit.
			disposables.add(session.onDidEndSession(() => {
				if (targetStates.includes(RuntimeState.Exited)) {
					completeStateChange();
				}
			}));

			// Ensure the timer's cleared.
			disposables.add(toDisposable(() => clearTimeout(timer)));
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


}
registerSingleton(IRuntimeSessionService, RuntimeSessionService, InstantiationType.Eager);
