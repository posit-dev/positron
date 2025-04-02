/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
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
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeExitReason, RuntimeState, LanguageStartupBehavior, formatLanguageRuntimeMetadata, formatLanguageRuntimeSession } from '../../languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeGlobalEvent, ILanguageRuntimeSession, ILanguageRuntimeSessionManager, ILanguageRuntimeSessionStateEvent, INotebookSessionUriChangedEvent, IRuntimeSessionMetadata, IRuntimeSessionService, IRuntimeSessionWillStartEvent, RuntimeStartMode } from './runtimeSessionService.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IModalDialogPromptInstance, IPositronModalDialogsService } from '../../positronModalDialogs/common/positronModalDialogs.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { IExtensionService } from '../../extensions/common/extensions.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ActiveRuntimeSession } from './activeRuntimeSession.js';
import { IUpdateService } from '../../../../platform/update/common/update.js';
import { multipleConsoleSessionsFeatureEnabled } from './positronMultipleConsoleSessionsFeatureFlag.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { localize } from '../../../../nls.js';

/**
 * The maximum number of active sessions a user can have running at a time.
 * This value is arbitrary and a limit to use for sanity purposes for the
 * multiple console sessions feature. This should be removed in the future
 * or made a setting if limiting concurrent active sessions is required.
 *
 * Only to be used with `console.multipleConsoleSessions` feaeture flag.
 */
const MAX_CONCURRENT_SESSIONS = 15;

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

	// A map of the starting consoles. This is keyed by the runtimeId
	// (metadata.runtimeId) of the runtime owning the session.
	// This is the replacement for _startingConsolesByLanguageId for multiple console sessions
	private readonly _startingConsolesByRuntimeId = new Map<string, ILanguageRuntimeMetadata>();

	// A map of the starting notebooks. This is keyed by the notebook URI
	// owning the session.
	private readonly _startingNotebooksByNotebookUri = new ResourceMap<ILanguageRuntimeMetadata>();

	// A map of sessions currently starting to promises that resolve when the session
	// is ready to use. This is keyed by the composition of the session mode, runtime ID,
	// and notebook URI. This map limits the number of sessions that can be started at once
	// per runtime due to the nature of the session key.
	private readonly _startingSessionsBySessionMapKey = new Map<string, DeferredPromise<string>>();

	// A map of sessions currently shutting down to promises that resolve when the session
	// has shut down. This is keyed by the session ID.
	private readonly _shuttingDownRuntimesBySessionId = new Map<string, Promise<void>>();

	/** A map of notebooks currently shutting down to promises that resolve when the notebook
	 * has exited, keyed by notebook URI. */
	private readonly _shuttingDownNotebooksByNotebookUri = new ResourceMap<DeferredPromise<void>>();

	// A map of the currently active console sessions. Since we can currently
	// only have one console session per language, this is keyed by the
	// languageId (metadata.languageId) of the session.
	private readonly _consoleSessionsByLanguageId = new Map<string, ILanguageRuntimeSession>();

	// A map of the currently active console sessions. Since we can
	// have multiple console sessions per runtime, this map is keyed by
	// the runtimeId (metadata.runtimeId) of the session.
	private readonly _consoleSessionsByRuntimeId = new Map<string, ILanguageRuntimeSession[]>();

	// A map of the number of sessions created per runtime ID. This is used to
	// make each session name unique.
	private readonly _consoleSessionCounterByRuntimeId = new Map<string, number>();

	// A map of the last active console session per langauge.
	// We can have multiple console sessions per language,
	// and this map provides access to the session that was
	// last active per language.
	private readonly _lastActiveConsoleSessionByLanguageId = new Map<string, ILanguageRuntimeSession>();

	// A map of the currently active notebook sessions. This is keyed by the notebook URI
	// owning the session.
	private readonly _notebookSessionsByNotebookUri = new ResourceMap<ILanguageRuntimeSession>();

	// An map of sessions that have been disconnected from the extension host,
	// from sessionId to session. We keep these around so we can reconnect them when
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

	// The event emitter for the onDidDeleteRuntime event.
	private readonly _onDidDeleteRuntimeSessionEmitter =
		this._register(new Emitter<string>);

	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IPositronModalDialogsService private readonly _positronModalDialogsService: IPositronModalDialogsService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IStorageService private readonly _storageService: IStorageService,
		@IUpdateService private readonly _updateService: IUpdateService
	) {

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
				`A file with the language ID ${languageId} was opened.`,
				true);
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
						this.restoreRuntimeSession(session.runtimeMetadata, session.metadata, false);
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

				// Clear map and fire deletion events to update
				// console session service consumers.
				this._disconnectedSessions.forEach(value => {
					this._onDidDeleteRuntimeSessionEmitter.fire(value.sessionId);
				});
				this._disconnectedSessions.clear();
			}
		}));

		this.scheduleUpdateActiveLanguages(25 * 1000);
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

	// An event that fires when a runtime is deleted.
	readonly onDidDeleteRuntimeSession = this._onDidDeleteRuntimeSessionEmitter.event;

	// The event emitter for the onDidUpdateNotebookSessionUri event.
	private readonly _onDidUpdateNotebookSessionUriEmitter =
		this._register(new Emitter<INotebookSessionUriChangedEvent>());

	// An event that fires when a notebook session's URI is updated.
	readonly onDidUpdateNotebookSessionUri = this._onDidUpdateNotebookSessionUriEmitter.event;

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
	 * Gets the console session for a runtime, if one exists.
	 * Used to associated a session with a runtime.
	 *
	 * @param runtimeId The runtime identifier of the session to retrieve.
	 * @param includeExited Whether to include exited sessions in the search. (default false, optional)
	 * @returns The console session with the given runtime identifier, or undefined if
	 *  no console session with the given runtime identifier exists.
	 */
	getConsoleSessionForRuntime(runtimeId: string, includeExited: boolean = false): ILanguageRuntimeSession | undefined {
		// It's possible that there are multiple consoles for the same runtime.
		// In that case, we return the most recently created.
		return Array.from(this._activeSessionsBySessionId.values())
			.map((info, index) => ({ info, index }))
			.sort((a, b) =>
				b.info.session.metadata.createdTimestamp - a.info.session.metadata.createdTimestamp
				// If the timestamps are the same, prefer the session that was inserted last.
				|| b.index - a.index)
			.find(({ info }) =>
				info.session.runtimeMetadata.runtimeId === runtimeId &&
				info.session.metadata.sessionMode === LanguageRuntimeSessionMode.Console &&
				(includeExited || info.state !== RuntimeState.Exited)
			)
			?.info.session;
	}

	/**
	 * Gets the console session for a language, if one exists.
	 *
	 * @param languageId The language identifier of the session to retrieve.
	 * @returns The console session with the given language identifier, or undefined if
	 *  no console session with the given language identifier exists.
	 */
	getConsoleSessionForLanguage(languageId: string): ILanguageRuntimeSession | undefined {
		const multiSessionsEnabled = multipleConsoleSessionsFeatureEnabled(this._configurationService);

		if (multiSessionsEnabled) {
			// Return the foreground session if the languageId matches
			if (this._foregroundSession?.runtimeMetadata.languageId === languageId) {
				return this.foregroundSession;
			}
			// Otherwise, return the last active session for the languageId if there is one
			return this._lastActiveConsoleSessionByLanguageId.get(languageId);
		} else {
			return this._consoleSessionsByLanguageId.get(languageId);
		}
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
		return session;
	}

	/**
	 * List all active runtime sessions.
	 *
	 * @returns The active sessions.
	 */
	getActiveSessions(): ActiveRuntimeSession[] {
		return Array.from(this._activeSessionsBySessionId.values());
	}

	/**
	 * Selects and starts a new runtime session, after shutting down any currently active
	 * sessions for the console or notebook.
	 *
	 * If `console.multipleConsoleSessions` is enabled this function works as decribed below:
	 *
	 * Select a session for the provided runtime.
	 *
	 * For console sessions, if there is an active console session for the runtime, set it as
	 *  the foreground session and return. If there is no active console session for the runtime,
	 * start a new session for the runtime. If there are multiple sessions for the runtime,
	 * the most recently created session is set as the foreground session.
	 *
	 * For notebooks, only one runtime session for a notebook URI is allowed. Starts a session for the
	 * new runtime after shutting down the session for the previous runtime. Do nothing if the runtime
	 * matches the active runtime for the notebook session.
	 *
	 * @param runtimeId The ID of the runtime to select
	 * @param source The source of the selection
	 * @param notebookUri The URI of the notebook selecting the runtime, if any
	 *
	 * @returns A promise that resolves to the session ID if a runtime session was started
	 */
	async selectRuntime(runtimeId: string, source: string, notebookUri?: URI): Promise<void> {
		const multiSessionsEnabled = multipleConsoleSessionsFeatureEnabled(this._configurationService);

		const runtime = this._languageRuntimeService.getRegisteredRuntime(runtimeId);
		if (!runtime) {
			throw new Error(`No language runtime with id '${runtimeId}' was found.`);
		}

		// Determine some session metadata values based off the session type (console vs notebook)
		const sessionMode = notebookUri
			? LanguageRuntimeSessionMode.Notebook
			: LanguageRuntimeSessionMode.Console;


		const startMode = notebookUri
			? RuntimeStartMode.Switching
			: multiSessionsEnabled ? RuntimeStartMode.Starting : RuntimeStartMode.Switching;


		// If a start request is already in progress, wait for it to complete.
		const startingPromise = this._startingSessionsBySessionMapKey.get(
			getSessionMapKey(sessionMode, runtimeId, notebookUri));
		if (startingPromise && !startingPromise.isSettled) {
			await startingPromise.p;
		}

		if (notebookUri) {
			// If a session is already shutting down for this notebook, wait for it to complete.
			const shuttingDownPromise = this._shuttingDownNotebooksByNotebookUri.get(notebookUri);
			if (shuttingDownPromise && !shuttingDownPromise.isSettled) {
				try {
					await shuttingDownPromise.p;
				} catch (error) {
					// Continue anyway; we assume the error is handled elsewhere.
				}
			}

			// Shut down any other sessions for the notebook.
			const activeSession =
				this.getNotebookSessionForNotebookUri(notebookUri);
			if (activeSession) {
				// If the active session is for the same runtime, we don't need to do anything.
				if (activeSession.runtimeMetadata.runtimeId === runtime.runtimeId) {
					return;
				}

				await this.shutdownRuntimeSession(activeSession, RuntimeExitReason.SwitchRuntime);
			}
		} else {
			if (multiSessionsEnabled) {
				// Check if there is a console session for this runtime already
				const existingSession = this.getConsoleSessionForRuntime(runtimeId, true);
				if (existingSession) {
					// Set it as the foreground session and return.
					if (existingSession.runtimeMetadata.runtimeId !== this.foregroundSession?.runtimeMetadata.runtimeId) {
						this.foregroundSession = existingSession;
					}
					return;
				}
			} else {
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
			}
		}

		// Wait for the selected runtime to start.
		await this.startNewRuntimeSession(
			runtime.runtimeId,
			runtime.runtimeName,
			sessionMode,
			notebookUri,
			source,
			startMode,
			true
		);
	}

	/**
	 * Focus a runtime session by setting it as the foreground session.
	 */
	focusSession(sessionId: string): void {
		const session = this.getSession(sessionId);
		if (!session) {
			throw new Error(`Could not find session with id {sessionId}.`);
		}

		if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
			this.foregroundSession = session;
		} else {
			// TODO: we could potentially focus the notebook editor in this case.
			throw new Error(`Cannot focus a notebook session.`);
		}
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
		const disposables = activeSession.register(new DisposableStore());
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
	 * @param activate Whether to activate/focus the session after it is started.
	 */
	async startNewRuntimeSession(runtimeId: string,
		sessionName: string,
		sessionMode: LanguageRuntimeSessionMode,
		notebookUri: URI | undefined,
		source: string,
		startMode = RuntimeStartMode.Starting,
		activate: boolean): Promise<string> {
		// See if we are already starting the requested session. If we
		// are, return the promise that resolves when the session is ready to
		// use. This makes it possible for multiple requests to start the same
		// session to be coalesced.
		const sessionMapKey = getSessionMapKey(sessionMode, runtimeId, notebookUri);
		const startingRuntimePromise = this._startingSessionsBySessionMapKey.get(sessionMapKey);
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
				return this.autoStartRuntime(languageRuntime, source, activate);
			} else {
				throw new Error(`Cannot start a ${sessionMode} session in an untrusted workspace.`);
			}
		}

		// Start the runtime.
		this._logService.info(
			`Starting session for language runtime ` +
			`${formatLanguageRuntimeMetadata(languageRuntime)} (Source: ${source})`);
		return this.doCreateRuntimeSession(languageRuntime, sessionName, sessionMode, source, startMode, activate, notebookUri);
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

		return sessionManager.validateSession(runtimeMetadata, sessionId);
	}

	/**
	 * Restores (reconnects to) a runtime session that was previously started.
	 *
	 * @param runtimeMetadata The metadata of the runtime to start.
	 * @param sessionMetadata The metadata of the session to start.
	 * @param activate Whether to activate/focus the session after it is
	 * reconnected.
	 */
	async restoreRuntimeSession(
		runtimeMetadata: ILanguageRuntimeMetadata,
		sessionMetadata: IRuntimeSessionMetadata,
		activate: boolean): Promise<void> {
		const multisessionEnabled = multipleConsoleSessionsFeatureEnabled(this._configurationService);

		// See if we are already starting the requested session. If we
		// are, return the promise that resolves when the session is ready to
		// use. This makes it possible for multiple requests to start the same
		// session to be coalesced.
		const sessionMapKey = getSessionMapKey(
			sessionMetadata.sessionMode, runtimeMetadata.runtimeId, sessionMetadata.notebookUri);
		if (!multisessionEnabled || sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Notebook) {
			const startingRuntimePromise = this._startingSessionsBySessionMapKey.get(sessionMapKey);
			if (startingRuntimePromise && !startingRuntimePromise.isSettled) {
				return startingRuntimePromise.p.then(() => { });
			}
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

		const startPromise = new DeferredPromise<string>();
		if (!multisessionEnabled || sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Notebook) {
			// Create a promise that resolves when the runtime is ready to use.
			this._startingSessionsBySessionMapKey.set(sessionMapKey, startPromise);

			// It's possible that startPromise is never awaited, so we log any errors here
			// at the debug level since we still expect the error to be handled/logged elsewhere.
			startPromise.p.catch((err) => this._logService.debug(`Error starting session: ${err}`));

			this.setStartingSessionMaps(
				sessionMetadata.sessionMode, runtimeMetadata, sessionMetadata.notebookUri);
		}
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
			if (!multisessionEnabled || sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Notebook) {
				this.clearStartingSessionMaps(
					sessionMetadata.sessionMode, runtimeMetadata, sessionMetadata.notebookUri);
			}
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
			if (!multisessionEnabled || sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Notebook) {
				this.clearStartingSessionMaps(
					sessionMetadata.sessionMode, runtimeMetadata, sessionMetadata.notebookUri);
			}
			throw err;
		}

		// Actually reconnect the session.
		try {
			await this.doStartRuntimeSession(session, sessionManager, RuntimeStartMode.Reconnecting, activate);
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

		if (session) {
			// Update the map of active console sessions per language
			this._lastActiveConsoleSessionByLanguageId.set(session.runtimeMetadata.languageId, session);
		}

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
	 * Gets a single active session, given its session ID.
	 *
	 * @param sessionId The session ID to retrieve.
	 * @returns The session with the given session ID, or undefined if no
	 *  session with the given session ID exists.
	 */
	getActiveSession(sessionId: string): ActiveRuntimeSession | undefined {
		return this._activeSessionsBySessionId.get(sessionId);
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

		const state = session.getRuntimeState();
		if (state === RuntimeState.Busy ||
			state === RuntimeState.Idle ||
			state === RuntimeState.Ready) {
			// The runtime looks like it could handle a restart request, so send
			// one over.
			return this.doRestartRuntime(session);
		} else if (state === RuntimeState.Uninitialized ||
			state === RuntimeState.Exited) {
			// The runtime has never been started, or is no longer running. Just
			// tell it to start.
			await this.startNewRuntimeSession(session.runtimeMetadata.runtimeId,
				session.metadata.sessionName,
				session.metadata.sessionMode,
				session.metadata.notebookUri,
				`'Restart Interpreter' command invoked`,
				RuntimeStartMode.Starting,
				true);
			return;
		} else if (state === RuntimeState.Starting ||
			state === RuntimeState.Restarting) {
			// The runtime is already starting or restarting. We could show an
			// error, but this is probably just the result of a user mashing the
			// restart when we already have one in flight.
			return;
		} else {
			// The runtime is not in a state where it can be restarted.
			throw new Error(`The ${session.runtimeMetadata.languageName} session is '${state}' ` +
				`and cannot be restarted.`);
		}
	}
	/**
	 * Interrupt a runtime session.
	 *
	 * @param sessionId The session ID of the runtime to interrupt.
	 */
	async interruptSession(sessionId: string): Promise<void> {
		const session = this.getSession(sessionId);
		if (!session) {
			throw new Error(`No session with ID '${sessionId}' was found.`);
		}
		this._logService.info(
			`Interrupting session ${formatLanguageRuntimeSession(session)}'`);

		return session.interrupt();
	}

	/**
	 * Internal method to restart a runtime session.
	 *
	 * @param session The runtime to restart.
	 */
	private async doRestartRuntime(session: ILanguageRuntimeSession): Promise<void> {
		// If there is already a runtime starting for the session, return its promise.
		const sessionMapKey = getSessionMapKey(
			session.metadata.sessionMode, session.runtimeMetadata.runtimeId, session.metadata.notebookUri);
		const startingRuntimePromise = this._startingSessionsBySessionMapKey.get(sessionMapKey);
		if (startingRuntimePromise && !startingRuntimePromise.isSettled) {
			return startingRuntimePromise.p.then(() => { });
		}

		const activeSession = this._activeSessionsBySessionId.get(session.sessionId);
		if (!activeSession) {
			throw new Error(`No active session '${session.sessionId}'`);
		}

		// Create a promise that resolves when the runtime is ready to use.
		const startPromise = new DeferredPromise<string>();
		this._startingSessionsBySessionMapKey.set(sessionMapKey, startPromise);

		// Mark the session as starting.
		this.setStartingSessionMaps(
			session.metadata.sessionMode, session.runtimeMetadata, session.metadata.notebookUri);

		// Mark the session as ready when it reaches the ready state,
		// or after a timeout.
		awaitStateChange(activeSession, [RuntimeState.Ready], 10)
			.then(() => {
				this.clearStartingSessionMaps(
					session.metadata.sessionMode, session.runtimeMetadata, session.metadata.notebookUri);
				startPromise.complete(session.sessionId);
			})
			.catch((err) => {
				startPromise.error(err);
				this.clearStartingSessionMaps(
					session.metadata.sessionMode, session.runtimeMetadata, session.metadata.notebookUri);
			});

		// Ask the runtime to restart.
		try {
			// Restart the working directory in the same directory as the session.
			await session.restart(activeSession.workingDirectory);
		} catch (err) {
			startPromise.error(err);
			this.clearStartingSessionMaps(
				session.metadata.sessionMode, session.runtimeMetadata, session.metadata.notebookUri);
		}

		return startPromise.p.then(() => { });
	}

	/**
	 * Shutdown a runtime session for a notebook.
	 *
	 * @param notebookUri The notebook's URI.
	 * @param exitReason The reason for exiting.
	 * @param source The source of the request to shutdown the session, for debugging purposes.
	 * @returns A promise that resolves when the session has exited.
	 */
	async shutdownNotebookSession(notebookUri: URI, exitReason: RuntimeExitReason, source: string): Promise<void> {
		this._logService.info(`Shutting down notebook ${notebookUri.toString()}. Source: ${source}`);

		// If there is a pending shutdown request for this notebook, return the existing promise.
		const shuttingDownPromise = this._shuttingDownNotebooksByNotebookUri.get(notebookUri);
		if (shuttingDownPromise && !shuttingDownPromise.isSettled) {
			this._logService.debug(`Notebook ${notebookUri.toString()} is already shutting down. Returning existing promise`);
			return shuttingDownPromise.p;
		}

		// Create a promise that resolves when the runtime has exited.
		const shutdownPromise = new DeferredPromise<void>();
		this._shuttingDownNotebooksByNotebookUri.set(notebookUri, shutdownPromise);

		// Remove the promise from the map of shutting down notebooks when it completes.
		shutdownPromise.p.finally(() => {
			if (this._shuttingDownNotebooksByNotebookUri.get(notebookUri) === shutdownPromise) {
				this._shuttingDownNotebooksByNotebookUri.delete(notebookUri);
			}
		});

		// Get the session to shutdown.
		const session = await this.getActiveOrStartingNotebook(notebookUri);
		if (!session) {
			this._logService.debug(
				`Aborting shutdown request for notebook ${notebookUri.toString()}. ` +
				`No active session found`
			);
			shutdownPromise.complete();
			return;
		}

		// Actually shutdown the session.
		try {
			await this.shutdownRuntimeSession(session, exitReason);
			shutdownPromise.complete();
			this._logService.debug(`Notebook ${notebookUri.toString()} has been shut down`);
		} catch (error) {
			this._logService.error(`Failed to shutdown notebook ${notebookUri.toString()}. Reason: ${error}`);
			shutdownPromise.error(error);
		}

		return shutdownPromise.p;
	}

	/**
	 * Shutdown a runtime session if active, and delete it.
	 * Cleans up the session and removes it from the active sessions list.
	 * @param sessionId The session ID of the runtime to delete.
	 */
	async deleteSession(sessionId: string): Promise<void> {
		// If the session is disconnected, we preserve the console session
		// in the case that the extension host comes back online.
		if (this._disconnectedSessions.has(sessionId)) {
			throw new Error(`Cannot delete session because it is disconnected.`);
		}

		const session = this.getSession(sessionId);
		if (!session) {
			throw new Error(`Cannot delete session because its runtime was not found.`);
		}

		const runtimeState = session.getRuntimeState();
		if (runtimeState !== RuntimeState.Exited) {
			if (runtimeState === RuntimeState.Busy ||
				runtimeState === RuntimeState.Idle ||
				runtimeState === RuntimeState.Ready) {
				// If the runtime is in a state where it can be shut down, do so.
				await this.shutdownRuntimeSession(session, RuntimeExitReason.Shutdown);
			} else {
				// Otherwise throw error.
				throw new Error(`Cannot delete session because it is in state '${runtimeState}'`);
			}
		}

		if (this._activeSessionsBySessionId.delete(sessionId)) {
			// Clean up if necessary (should already by done once the runtime is exited).
			this._consoleSessionsByLanguageId.delete(session.runtimeMetadata.languageId);

			// Dispose of the session.
			session.dispose();

			// Fire the onDidDeleteRuntime event only if the session was actually deleted.
			this._onDidDeleteRuntimeSessionEmitter.fire(sessionId);
		}
	}

	/**
	 * Helper to get an active or starting session for a notebook URI. Returns undefined if there is
	 * no active session or if an error was encountered while the session was starting.
	 */
	private async getActiveOrStartingNotebook(notebookUri: URI): Promise<ILanguageRuntimeSession | undefined> {
		// Check if there is an active session for the notebook.
		const session = this._notebookSessionsByNotebookUri.get(notebookUri);
		if (session) {
			this._logService.debug(`Found an active session for notebook ${notebookUri.toString()}`);
			return session;
		}

		// Check if there is a starting session for the notebook.
		const startingRuntime = this._startingNotebooksByNotebookUri.get(notebookUri);
		if (!startingRuntime) {
			this._logService.debug(`No starting session for notebook ${notebookUri.toString()}`);
			return undefined;
		}

		// Get the starting promise.
		const sessionMapKey = getSessionMapKey(
			LanguageRuntimeSessionMode.Notebook, startingRuntime.runtimeId, notebookUri);
		const startingPromise = this._startingSessionsBySessionMapKey.get(sessionMapKey);
		if (!startingPromise) {
			this._logService.debug(`No starting session for notebook ${notebookUri.toString()}`);
			return undefined;
		}

		// Wait for the session to start.
		this._logService.debug(`Waiting for session to start before shutting down notebook ${notebookUri.toString()}`);
		let sessionId: string;
		try {
			sessionId = await startingPromise.p;
		} catch (error) {
			// We assume that the error is handled elsewhere but log for debugging purposes.
			this._logService.debug(
				`Error while waiting for session to start for notebook ${notebookUri.toString()}. Reason: ${error.toString()}`
			);
			return undefined;
		}

		// Get the session object.
		const activeSession = this._activeSessionsBySessionId.get(sessionId);
		if (!activeSession) {
			// This should not happen, log an error.
			this._logService.error(`Session '${sessionId}' was started, but no active session was found`);
			return undefined;
		}

		// Wait for the session to be ready.
		if (activeSession.session.getRuntimeState() === RuntimeState.Starting) {
			try {
				await awaitStateChange(activeSession, [RuntimeState.Ready], 10);
			} catch (err) {
				// Continue even though the session isn't yet ready.
				// We assume the underlying error is handled elsewhere.
			}
		}

		return activeSession.session;
	}

	/**
	 * Checks for a starting or running console for the given language ID.
	 * Otherwise, checks if there are any starting or running consoles.
	 *
	 * @param languageId The language ID to check for; if undefined, checks for
	 * 	any starting or running console.
	 */
	hasStartingOrRunningConsole(languageId?: string | undefined) {
		const multiSessionsEnabled = multipleConsoleSessionsFeatureEnabled(this._configurationService);

		if (multiSessionsEnabled) {
			let hasRunningConsole = false;
			const hasRunningConsoleForLanguageId = Array.from(this._consoleSessionsByRuntimeId.values())
				.some((sessions) => {
					// Check if this runtime has any console sessions
					if (sessions.length > 0) {
						hasRunningConsole = true;
						// Does this runtime belong to the language we are interested in?
						if (sessions[0].runtimeMetadata.languageId === languageId) {
							return true;
						}
					}
					return false;
				});

			const hasStartingConsoleForLanguageId = Array.from(this._startingConsolesByRuntimeId.values())
				.some(
					runtime => runtime.languageId === languageId);

			if (languageId) {
				return hasStartingConsoleForLanguageId || hasRunningConsoleForLanguageId;
			} else {
				return this._startingConsolesByRuntimeId.size > 0 || hasRunningConsole;
			}
		} else {
			if (languageId) {
				return this._startingConsolesByLanguageId.has(languageId) ||
					this._consoleSessionsByLanguageId.has(languageId);
			} else {
				return this._startingConsolesByLanguageId.size > 0 ||
					this._consoleSessionsByLanguageId.size > 0;
			}
		}
	}

	/**
	 * Automatically starts a runtime.
	 *
	 * @param runtime The runtime to start.
	 * @param source The source of the request to start the runtime.
	 * @param activate Whether to activate/focus the new session after it
	 * starts.
	 *
	 * @returns A promise that resolves with a session ID for the new session,
	 * if one was started.
	 */
	async autoStartRuntime(
		metadata: ILanguageRuntimeMetadata,
		source: string,
		activate: boolean
	): Promise<string> {
		// Check the setting to see if we should be auto-starting.
		const startupBehavior = this._configurationService.getValue<LanguageStartupBehavior>(
			'interpreters.startupBehavior', { overrideIdentifier: metadata.languageId });
		if (startupBehavior === LanguageStartupBehavior.Disabled || startupBehavior === LanguageStartupBehavior.Manual) {
			this._logService.info(`Language runtime ` +
				`${formatLanguageRuntimeMetadata(metadata)} ` +
				`was scheduled for automatic start, but won't be started because automatic ` +
				`startup for the ${metadata.languageName} language is set to ${startupBehavior}. Source: ${source}`);
			return '';
		}

		if (this._workspaceTrustManagementService.isWorkspaceTrusted()) {
			// If the workspace is trusted, start the runtime.
			this._logService.info(`Language runtime ` +
				`${formatLanguageRuntimeMetadata(metadata)} ` +
				`automatically starting. Source: ${source}`);

			return this.doAutoStartRuntime(metadata, source, activate);
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
				this.doAutoStartRuntime(metadata, source, activate);
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
		const multiSessionsEnabled = multipleConsoleSessionsFeatureEnabled(this._configurationService);

		// If the resource is a string, parse it as a URI.
		if (typeof resource === 'string') {
			resource = URI.parse(resource);
		}

		// Options cannot be handled.
		if (options) {
			return false;
		}

		if (multiSessionsEnabled) {
			// Enumerate the last known active console sessions per language and attempt to open
			// the resource.
			for (const session of this._lastActiveConsoleSessionByLanguageId.values()) {
				try {
					if (await session.openResource(resource)) {
						return true;
					}
				} catch (reason) {
					this._logService.error(`Error opening resource "${resource.toString()}". Reason: ${reason}`);
				}
			}

		} else {
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
	 * @param activate Whether to activate/focus the new session after it is
	 * started.
	 */
	private async doAutoStartRuntime(
		metadata: ILanguageRuntimeMetadata,
		source: string,
		activate: boolean): Promise<string> {
		const multiSessionsEnabled = multipleConsoleSessionsFeatureEnabled(this._configurationService);

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
		if (multiSessionsEnabled) {
			this._startingConsolesByRuntimeId.set(metadata.runtimeId, metadata);
		} else {
			this._startingConsolesByLanguageId.set(metadata.languageId, metadata);
		}

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
				if (multiSessionsEnabled) {
					this._startingConsolesByRuntimeId.set(metadata.runtimeId, validated);
				} else {
					this._startingConsolesByLanguageId.set(metadata.languageId, validated);
				}

			} catch (err) {
				// Clear this from the set of starting consoles.
				if (multiSessionsEnabled) {
					this._startingConsolesByRuntimeId.delete(metadata.runtimeId);
				} else {
					this._startingConsolesByLanguageId.delete(metadata.languageId);
				}

				// Log the error and re-throw it.
				this._logService.error(
					`Language runtime ${formatLanguageRuntimeMetadata(metadata)} ` +
					`could not be validated. Reason: ${err}`);
				throw err;
			}
		}

		return this.doCreateRuntimeSession(metadata, metadata.runtimeName, sessionMode, source, RuntimeStartMode.Starting, activate, notebookUri);
	}

	/**
	 * Creates and starts a runtime session.
	 *
	 * @param runtimeMetadata The metadata for the runtime to start.
	 * @param sessionName A human-readable name for the session.
	 * @param sessionMode The mode for the new session.
	 * @param source The source of the request to start the runtime.
	 * @param startMode The mode in which to start the runtime.
	 * @param activate Whether to activate/focus the session after it is started.
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
		activate: boolean,
		notebookUri?: URI): Promise<string> {
		const multiSessionsEnabled = multipleConsoleSessionsFeatureEnabled(this._configurationService);

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

		// Determine if the console session name should be appended with a session count to make it unique.
		let updatedSessionName = sessionName;
		if (sessionMode === LanguageRuntimeSessionMode.Console && multiSessionsEnabled) {
			let sessionCount = this._consoleSessionCounterByRuntimeId.get(runtimeMetadata.runtimeId);
			if (sessionCount) {
				// Increment the session count for the runtime and append it to the session name.
				sessionCount++;
				this._consoleSessionCounterByRuntimeId.set(runtimeMetadata.runtimeId, sessionCount);
				updatedSessionName = `${sessionName} - ${sessionCount}`;
			} else {
				// Initialize the session count for the runtime.
				// The first session for a runtime does not append this count to the session name.
				this._consoleSessionCounterByRuntimeId.set(runtimeMetadata.runtimeId, 1);
			}
		}

		const sessionId = this.generateNewSessionId(runtimeMetadata, sessionMode === LanguageRuntimeSessionMode.Notebook);
		const sessionMetadata: IRuntimeSessionMetadata = {
			sessionId,
			sessionName: updatedSessionName,
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
			await this.doStartRuntimeSession(session, sessionManager, startMode, activate);
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
	 * @param activate Whether to activate/focus the session after it is started.
	 */
	private async doStartRuntimeSession(session: ILanguageRuntimeSession,
		manager: ILanguageRuntimeSessionManager,
		startMode: RuntimeStartMode,
		activate: boolean):
		Promise<void> {
		const multiSessionsEnabled = multipleConsoleSessionsFeatureEnabled(this._configurationService);

		// Fire the onWillStartRuntime event.
		const evt: IRuntimeSessionWillStartEvent = {
			session,
			startMode,
			activate
		};
		this._onWillStartRuntimeEmitter.fire(evt);

		// Attach event handlers to the newly provisioned session.
		this.attachToSession(session, manager, activate);

		try {
			// Attempt to start, or reconnect to, the session.
			await session.start();

			// The session has started. Move it from the starting runtimes to the
			// running runtimes.
			this.clearStartingSessionMaps(
				session.metadata.sessionMode, session.runtimeMetadata, session.metadata.notebookUri);

			if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
				const languageId = session.runtimeMetadata.languageId;
				if (multiSessionsEnabled) {
					// Append the new session to the list of existing sessions if it hasn't been added
					this.addSessionToConsoleSessionMap(session);
				} else {
					this._consoleSessionsByLanguageId.set(languageId, session);
				}
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
	 * @param activate Whether to activate/focus the session after it is started.
	 */
	private attachToSession(
		session: ILanguageRuntimeSession,
		manager: ILanguageRuntimeSessionManager,
		activate: boolean): void {
		const multiSessionsEnabled = multipleConsoleSessionsFeatureEnabled(this._configurationService);

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
					// If the session is a console session, make it the
					// foreground session if it isn't already.
					if (session !== this._foregroundSession &&
						session.metadata.sessionMode === LanguageRuntimeSessionMode.Console &&
						activate) {
						this.foregroundSession = session;
					}

					// Restore the session in the case of a restart.
					if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
						if (multiSessionsEnabled) {
							this.addSessionToConsoleSessionMap(session);
						} else {
							if (!this._consoleSessionsByLanguageId.has(session.runtimeMetadata.languageId)) {
								this._consoleSessionsByLanguageId.set(session.runtimeMetadata.languageId,
									session);
							}
						}
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
							activate: false
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
		const multiSessionsEnabled = multipleConsoleSessionsFeatureEnabled(this._configurationService);

		if (sessionMode === LanguageRuntimeSessionMode.Console) {

			if (multiSessionsEnabled) {
				// The current runtime session for the language must complete startup before another
				// session for the same runtime can be requested to start. This is required
				// because sessions that are starting get tracked using a key created from
				// the sessionMode and runtimeId. These fields are not unique enough to handle
				// starting multiple console sessions with the same runtimeId.
				const startingLanguageRuntime = this._startingConsolesByRuntimeId.get(
					languageRuntime.runtimeId);
				if (startingLanguageRuntime) {
					throw new Error(`Session for language runtime ` +
						`${formatLanguageRuntimeMetadata(languageRuntime)} ` +
						`cannot be started because language runtime ` +
						`${formatLanguageRuntimeMetadata(startingLanguageRuntime)} ` +
						`is already starting for the language.` +
						(source ? ` Request source: ${source}` : ``));
				}
			} else {
				// If there is already a runtime starting for the language, throw an error.
				// In the multiple console session world, we can have multiple runtimes
				// starting for the same language. Thus, we can skip this check unless
				// we have multiple console sessions disabled.
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
			}

			if (multiSessionsEnabled) {
				// Restrict the number of console sessions that can be created to 15.
				// This value is arbitrary and should be made a configuration setting
				// in the future for users once this feature has stabilized!
				if (this._activeSessionsBySessionId.size >= MAX_CONCURRENT_SESSIONS) {
					this._notificationService.notify({
						severity: Severity.Info,
						message: localize('positron.console.maxError', "Cannot start console session.\
							The maximum number of consoles ({0}) has been reached", MAX_CONCURRENT_SESSIONS)
					});

					throw new Error(`Session for language runtime ` +
						`${formatLanguageRuntimeMetadata(languageRuntime)} ` +
						`cannot be started because the maximum number of ` +
						`runtime sessions has been reached.`
					);
				}
			} else {
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
		const multiSessionsEnabled = multipleConsoleSessionsFeatureEnabled(this._configurationService);

		if (sessionMode === LanguageRuntimeSessionMode.Console) {
			if (multiSessionsEnabled) {
				this._startingConsolesByRuntimeId.set(runtimeMetadata.runtimeId, runtimeMetadata);
			} else {
				this._startingConsolesByLanguageId.set(runtimeMetadata.languageId, runtimeMetadata);
			}
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
		const multiSessionsEnabled = multipleConsoleSessionsFeatureEnabled(this._configurationService);
		const sessionMapKey = getSessionMapKey(sessionMode, runtimeMetadata.runtimeId, notebookUri);
		this._startingSessionsBySessionMapKey.delete(sessionMapKey);
		if (sessionMode === LanguageRuntimeSessionMode.Console) {
			if (multiSessionsEnabled) {
				this._startingConsolesByRuntimeId.delete(runtimeMetadata.runtimeId);
			} else {
				this._startingConsolesByLanguageId.delete(runtimeMetadata.languageId);
			}
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
		const multiSessionsEnabled = multipleConsoleSessionsFeatureEnabled(this._configurationService);

		if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
			if (multiSessionsEnabled) {
				const runtimeConsoleSessions = this._consoleSessionsByRuntimeId.
					get(session.runtimeMetadata.runtimeId) || [];

				// Filter out the session that is no longer running
				const newRuntimeConsoleSessions = runtimeConsoleSessions.filter(s => s.sessionId !== session.sessionId);

				if (newRuntimeConsoleSessions.length > 0) {
					this._consoleSessionsByRuntimeId.set(session.runtimeMetadata.runtimeId, newRuntimeConsoleSessions);
				} else {
					// Remove the key entirely from the map since there are no sessions for the runtime
					this._consoleSessionsByRuntimeId.delete(session.runtimeMetadata.runtimeId);
				}
			} else {
				// The session is no longer running, so if it's the active console session, clear it.
				const consoleSession = this._consoleSessionsByLanguageId.get(session.runtimeMetadata.languageId);
				if (consoleSession?.sessionId === session.sessionId) {
					this._consoleSessionsByLanguageId.delete(session.runtimeMetadata.languageId);
				}
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
	 * Adds a session to the _consoleSessionsByRuntimeId if it hasn't been added
	 *
	 * @param session The session to remove
	 */
	private addSessionToConsoleSessionMap(session: ILanguageRuntimeSession) {
		const runtimeId = session.runtimeMetadata.runtimeId;
		const runtimeSessions = this._consoleSessionsByRuntimeId.get(runtimeId) || [];

		// Has the session already been added?
		const foundSession = runtimeSessions?.some(s => s.sessionId === session.sessionId);

		if (!foundSession) {
			this._consoleSessionsByRuntimeId.set(runtimeId, [...runtimeSessions, session]);
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

	private generateNewSessionId(metadata: ILanguageRuntimeMetadata, isNotebook: boolean | undefined): string {
		// Generate a random session ID. We use fairly short IDs to make them more readable.
		const id = `${metadata.languageId}-${isNotebook ? 'notebook-' : ''}${Math.random().toString(16).slice(2, 10)}`;

		// Since the IDs are short, there's a chance of collision. If we have a collision, try again.
		if (this._activeSessionsBySessionId.has(id)) {
			return this.generateNewSessionId(metadata, isNotebook);
		}

		return id;
	}

	private async scheduleUpdateActiveLanguages(delay = 60 * 60 * 1000): Promise<IDisposable> {
		const updateLanguagesDisposable = disposableTimeout(() => {
			this.updateActiveLanguages();

			// Schedule the next update with default delay after the first update during service startup
			this.scheduleUpdateActiveLanguages();
		}, delay);

		this._register(updateLanguagesDisposable);
		return updateLanguagesDisposable;
	}

	public updateActiveLanguages(): void {
		const languages = new Set<string>();
		this._activeSessionsBySessionId.forEach(activeSession => {
			// get the beginning of the day in UTC so that usage is the same 24-hour period across time zones
			const startUTC = new Date(Date.now()).setUTCHours(0, 0, 0, 0);
			const lastUsed = activeSession.session.lastUsed;

			// only update the active languages if the session was used today
			if (lastUsed > startUTC && activeSession.session.getRuntimeState() !== RuntimeState.Exited) {
				languages.add(activeSession.session.runtimeMetadata.languageId);
			}
		});
		this._updateService.updateActiveLanguages([...languages]);
	}

	/**
	 * Updates the URI of a notebook session to maintain session continuity when
	 * a notebook is saved under a new URI.
	 *
	 * This is a crucial operation during the Untitled → Saved file transition, as it:
	 * 1. Preserves all runtime state (variables, execution context, kernel connections)
	 * 2. Updates internal mappings to reflect the new URI
	 * 3. Notifies dependent components about the change (via the onDidUpdateNotebookSessionUri event)
	 *
	 * The implementation carefully orders operations to maintain state consistency even if
	 * an error occurs during the update process.
	 *
	 * @param oldUri The original URI of the notebook (typically an untitled:// URI)
	 * @param newUri The new URI of the notebook (typically a file:// URI after saving)
	 * @returns The session ID of the updated session, or undefined if no update occurred
	 */
	updateNotebookSessionUri(oldUri: URI, newUri: URI): string | undefined {

		// Find the session associated with the old URI
		const session = this._notebookSessionsByNotebookUri.get(oldUri);

		if (!session) {
			// No matching session found for the provided oldUri
			// Why logging as debug: This is an expected case when notebooks don't have sessions yet
			this._logService.debug(`No notebook session found for URI: ${oldUri.toString()}`);
			return undefined;
		}

		// Check if session is in a valid state for URI reassignment
		// Why: We can't reassign a terminated session as it's no longer active and would cause
		// users to think they have a working session when they don't
		if (session.getRuntimeState() === RuntimeState.Exited) {
			this._logService.warn('Cannot update URI for terminated session', {
				sessionId: session.sessionId,
				oldUri: oldUri.toString()
			});
			return undefined;
		}

		// Remember the session ID for return value
		const sessionId = session.sessionId;

		try {
			// Operations are performed in a specific order to maintain atomic-like behavior
			// The ordering ensures that even if interrupted between steps, the system won't lose
			// track of the session completely.

			// 1. First add the new mapping to ensure we don't lose the session
			// Why: This makes the session accessible via the new URI immediately,
			// so even if the next steps fail, the session is still accessible via some URI
			this._notebookSessionsByNotebookUri.set(newUri, session);

			// 2. Then update the session's notebook URI in its dynamic state
			// Why: This ensures the session's internal references are consistent
			// with our mapping, which helps debugging and ensures session properties
			// reflect current reality
			session.dynState.currentNotebookUri = newUri;

			// 3. Finally remove the old mapping - we do this last because it's
			// the most likely to fail if ResourceMap has internal inconsistency
			// Why last: If we deleted first and then failed to add the new mapping,
			// we'd lose the session entirely
			this._notebookSessionsByNotebookUri.delete(oldUri);

			// Log success for debugging
			this._logService.debug(`Successfully updated notebook session URI: ${oldUri.toString()} → ${newUri.toString()}`);

			// Notify listeners that the URI has been updated
			// Why: Components like the variables view need to update their UI
			// to show the new filename instead of "Untitled-1", and any code that tracks
			// notebook URIs needs to update its references
			this._onDidUpdateNotebookSessionUriEmitter.fire({
				sessionId,
				oldUri,
				newUri
			});

			return sessionId;
		} catch (error) {
			// If anything went wrong, attempt to restore the old state manually
			this._logService.error('Failed to update notebook session URI', error);

			// Manual restoration in reverse order to maintain consistency

			// 1. Try to restore old mapping if it was deleted
			// Why: If we got as far as deleting the old mapping, we need to restore it
			// so the session can still be found via the original URI
			if (!this._notebookSessionsByNotebookUri.has(oldUri)) {
				this._notebookSessionsByNotebookUri.set(oldUri, session);
			}

			// 2. Clean up possibly invalid new mapping
			// Why: We only delete the new mapping if it points to our session
			// This avoids accidentally deleting a valid mapping that might have been
			// created by another operation
			if (this._notebookSessionsByNotebookUri.get(newUri) === session) {
				this._notebookSessionsByNotebookUri.delete(newUri);
			}

			// 3. Restore original URI in session state if needed
			// Why: Keep the session's internal state consistent with our mappings
			if (session.dynState.currentNotebookUri === newUri) {
				session.dynState.currentNotebookUri = oldUri;
			}

			return undefined;
		}
	}
}

registerSingleton(IRuntimeSessionService, RuntimeSessionService, InstantiationType.Eager);

/**
 * Wait for a session to change to one of the target states.
 *
 * @param activeSession The session to watch.
 * @param targetStates The target states for the session to enter.
 * @param seconds The number of seconds to wait for the session to change to the target state
 * 	before timing out.
 * @returns A promise that resolves when the session enters one of the target states, or rejects
 *  after a timeout.
 */
function awaitStateChange(
	activeSession: ActiveRuntimeSession,
	targetStates: RuntimeState[],
	seconds: number,
): Promise<void> {
	const { session } = activeSession;
	return new Promise<void>((resolve, reject) => {
		const disposables = activeSession.register(new DisposableStore());

		// Reject after a timeout.
		disposables.add(disposableTimeout(() => {
			disposables.dispose();
			const formattedTargetStates = targetStates.map(s => `'${s}'`).join(' or ');
			reject(new Error(`Timed out waiting for runtime ` +
				`${formatLanguageRuntimeSession(session)} to be ${formattedTargetStates}.`));
		}, seconds * 1000));

		// Listen for state changes.
		disposables.add(session.onDidChangeRuntimeState((state) => {
			if (targetStates.includes(state)) {
				disposables.dispose();
				resolve();
			}
		}));

		// Listen for the session to end. This should be treated as an exit
		// for the purposes of waiting for the session to exit.
		if (targetStates.includes(RuntimeState.Exited)) {
			disposables.add(session.onDidEndSession(() => {
				disposables.dispose();
				resolve();
			}));
		}
	});
}
