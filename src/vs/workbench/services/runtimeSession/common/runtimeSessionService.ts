/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, ILanguageRuntimeSessionState, RuntimeState, ILanguageRuntimeInfo, ILanguageRuntimeStartupFailure, ILanguageRuntimeExit, ILanguageRuntimeClientCreatedEvent, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageStream, ILanguageRuntimeMessageInput, ILanguageRuntimeMessageError, ILanguageRuntimeMessagePrompt, ILanguageRuntimeMessageState, RuntimeCodeExecutionMode, RuntimeErrorBehavior, RuntimeCodeFragmentStatus, RuntimeExitReason, ILanguageRuntimeMessageResult, ILanguageRuntimeMessageClearOutput, ILanguageRuntimeMessageIPyWidget } from '../../languageRuntime/common/languageRuntimeService.js';
import { RuntimeClientType, IRuntimeClientInstance } from '../../languageRuntime/common/languageRuntimeClientInstance.js';
import { IRuntimeClientEvent } from '../../languageRuntime/common/languageRuntimeUiClient.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { ActiveRuntimeSession } from './activeRuntimeSession.js';

export const IRuntimeSessionService =
	createDecorator<IRuntimeSessionService>('runtimeSessionService');

export interface ILanguageRuntimeGlobalEvent {
	/** The ID of the session from which the event originated */
	session_id: string;

	/** The event itself */
	event: IRuntimeClientEvent;
}

/**
 * The mode in which a runtime session is starting.
 */
export enum RuntimeStartMode {
	/** A new runtime is starting. */
	Starting = 'starting',

	/** An existing runtime is restarting. */
	Restarting = 'restarting',

	/** An existing runtime is reconnecting. */
	Reconnecting = 'reconnecting',

	/** The previous runtime is being switched to a new runtime. */
	Switching = 'switching',
}

/**
 * The output channels provided by a language runtime.
 * Copy for core Positron code.
 */
export enum LanguageRuntimeSessionChannel {
	Console = 'console',
	Kernel = 'kernel',
	LSP = 'lsp',
}

/**
 * Event that fires when a runtime session is about to start.
 */
export interface IRuntimeSessionWillStartEvent {
	/** The mode in which the session is starting. */
	startMode: RuntimeStartMode;

	/** Whether the runtime should be activated when it starts */
	activate: boolean;

	/** The session about to start */
	session: ILanguageRuntimeSession;
}

export interface ILanguageRuntimeSessionStateEvent {
	/** The ID of the session that changed states */
	session_id: string;

	/** The runtime's previous state */
	old_state: RuntimeState;

	/** The runtime's new state */
	new_state: RuntimeState;
}

export interface IRuntimeSessionMetadata {
	/** The unique identifier of the session */
	readonly sessionId: string;

	/** A user-friendly name for the session */
	readonly sessionName: string;

	/** The session's mode  */
	readonly sessionMode: LanguageRuntimeSessionMode;

	/** The notebook associated with the session, if any */
	readonly notebookUri: URI | undefined;

	/**
	 * A timestamp (in milliseconds since the Epoch) representing the time at
	 * which the runtime session was created.
	 */
	readonly createdTimestamp: number;

	/**
	 * The reason the session was started; non-localized and only used for
	 * debugging.
	 */
	readonly startReason: string;
}

/**
 * The main interface for interacting with a language runtime session.
 */

export interface ILanguageRuntimeSession extends IDisposable {
	/** The language runtime's static metadata */
	readonly runtimeMetadata: ILanguageRuntimeMetadata;

	/** The session's static metadata */
	readonly metadata: IRuntimeSessionMetadata;

	/** The unique identifier of the session */
	readonly sessionId: string;

	/** The language runtime's dynamic metadata */
	dynState: ILanguageRuntimeSessionState;

	/** An object that emits events when the runtime state changes */
	onDidChangeRuntimeState: Event<RuntimeState>;

	/** An object that emits an event when the runtime completes startup */
	onDidCompleteStartup: Event<ILanguageRuntimeInfo>;

	/** An object that emits an event when runtime startup fails */
	onDidEncounterStartupFailure: Event<ILanguageRuntimeStartupFailure>;

	/** An object that emits an event when the runtime exits */
	onDidEndSession: Event<ILanguageRuntimeExit>;

	/**
	 * An object that emits an event when a client instance (comm) is created
	 * from the runtime side. Note that this only fires when an instance is
	 * created from the runtime side; it does not fire when
	 * `createClient` is called from the front end.
	 */
	onDidCreateClientInstance: Event<ILanguageRuntimeClientCreatedEvent>;

	onDidReceiveRuntimeMessageClearOutput: Event<ILanguageRuntimeMessageClearOutput>;
	onDidReceiveRuntimeMessageOutput: Event<ILanguageRuntimeMessageOutput>;
	onDidReceiveRuntimeMessageResult: Event<ILanguageRuntimeMessageResult>;
	onDidReceiveRuntimeMessageStream: Event<ILanguageRuntimeMessageStream>;
	onDidReceiveRuntimeMessageInput: Event<ILanguageRuntimeMessageInput>;
	onDidReceiveRuntimeMessageError: Event<ILanguageRuntimeMessageError>;
	onDidReceiveRuntimeMessagePrompt: Event<ILanguageRuntimeMessagePrompt>;
	onDidReceiveRuntimeMessageState: Event<ILanguageRuntimeMessageState>;
	onDidReceiveRuntimeClientEvent: Event<IRuntimeClientEvent>;
	onDidReceiveRuntimeMessagePromptConfig: Event<void>;
	onDidReceiveRuntimeMessageIPyWidget: Event<ILanguageRuntimeMessageIPyWidget>;

	/** The current state of the runtime (tracks events above) */
	getRuntimeState(): RuntimeState;

	/** Timestamp of when the runtime was last used */
	get lastUsed(): number;

	/**
	 * The (cached) current set of client instances that are known to Positron.
	 * Note that this list may not reflect the full set of clients that are
	 * known to the the backend; to request the full set of clients from the
	 * backend, use `listClients`.
	 */
	clientInstances: IRuntimeClientInstance<any, any>[];

	/**
	 * Opens a resource in the runtime.
	 * @param resource The resource to open.
	 * @returns true if the resource was opened; otherwise, false.
	 */
	openResource(resource: URI | string): Thenable<boolean>;

	/** Execute code in the runtime */
	execute(code: string,
		id: string,
		mode: RuntimeCodeExecutionMode,
		errorBehavior: RuntimeErrorBehavior): void;

	/** Test a code fragment for completeness */
	isCodeFragmentComplete(code: string): Thenable<RuntimeCodeFragmentStatus>;

	/**
	 * Create a new instance of a client; return null if the client type
	 * is not supported by this runtime.
	 *
	 * @param type The type of client to create
	 * @param params The parameters to pass to the client constructor
	 * @param metadata The metadata to pass to the client constructor
	 * @param id The unique identifier for the client instance. Defaults to a randomly generated ID.
	 */
	createClient<T, U>(type: RuntimeClientType, params: any, metadata?: any, id?: string): Thenable<IRuntimeClientInstance<T, U>>;

	/** Get a list of all known clients */
	listClients(type?: RuntimeClientType): Thenable<Array<IRuntimeClientInstance<any, any>>>;

	/** Reply to an input prompt that the runtime issued
	 * (via a LanguageRuntimePrompt message)
	 */
	replyToPrompt(id: string, value: string): void;

	/**
	 * Set the runtime's working directory.
	 */
	setWorkingDirectory(directory: string): Thenable<void>;

	start(): Thenable<ILanguageRuntimeInfo>;

	/** Interrupt the runtime */
	interrupt(): void;

	/** Restart the runtime */
	restart(workingDirectory?: string): Thenable<void>;

	/** Shut down the runtime */
	shutdown(exitReason?: RuntimeExitReason): Thenable<void>;

	/** Force quit the runtime */
	forceQuit(): Thenable<void>;

	/** Show output log of the runtime */
	showOutput(channel?: LanguageRuntimeSessionChannel): void;

	/** Retrieve list of output channels provided by this Language Runtime */
	listOutputChannels(): Thenable<LanguageRuntimeSessionChannel[]>;

	/** Show profiler log of the runtime, if supported */
	showProfile(): Thenable<void>;

	/** Get the label associated with the session. This is a more human-readable name for the session. */
	getLabel(): string;
}

/**
 * A manager for runtime sessions.
 */
export interface ILanguageRuntimeSessionManager {
	/**
	 * Indicate whether this session manager is responsible for the given runtime.
	 *
	 * @param runtimeId The runtime identifier to check.
	 */
	managesRuntime(runtime: ILanguageRuntimeMetadata): Promise<boolean>;

	/**
	 * Create (provision) a new session.
	 *
	 * @param runtimeMetadata The metadata of the runtime for which a session is
	 *  	to be created.
	 * @param sessionMetadata The metadata of the session to be created.
	 *
	 * @returns A promise that resolves to the new session.
	 */
	createSession(
		runtimeMetadata: ILanguageRuntimeMetadata,
		sessionMetadata: IRuntimeSessionMetadata):
		Promise<ILanguageRuntimeSession>;

	/**
	 * Validates an existing (persisted) session.
	 */
	validateSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionId: string): Promise<boolean>;

	/**
	 * Restore (reconnect to) an existing session.
	 *
	 * @param runtimeMetadata The metadata of the runtime for which a session is
	 *  	to be restored (reconnected).
	 * @param sessionMetadata The metadata of the session to be restored.
	 *
	 * @returns A promise that resolves to the reconnected session.
	 */
	restoreSession(
		runtimeMetadata: ILanguageRuntimeMetadata,
		sessionMetadata: IRuntimeSessionMetadata):
		Promise<ILanguageRuntimeSession>;

	/**
	 * Validates a runtime metadata object. Returns the updated metadata object,
	 * or throws an error if the metadata is invalid.
	 *
	 * @param metadata The metadata of the runtime to validate.
	 *
	 * @returns A promise that resolves to the validated metadata.
	 */
	validateMetadata(metadata: ILanguageRuntimeMetadata): Promise<ILanguageRuntimeMetadata>;
}


/**
 * The runtime session service is the main interface for interacting with
 * runtime sessions; it manages the set of active sessions and provides
 * facilities for starting, stopping, and interacting with them.
 */
/**
 * Event that fires when a notebook session's URI has been updated.
 *
 * This event is for components that track notebook URIs (like the variables view)
 * to update their references when a notebook is saved with a new URI. Without this event,
 * UI components would continue to display the old URI even after saving.
 */
export interface INotebookSessionUriChangedEvent {
	/** The session ID that was updated */
	readonly sessionId: string;
	/** The previous URI associated with the session (typically an untitled URI) */
	readonly oldUri: URI;
	/** The new URI associated with the session (typically a file URI after saving) */
	readonly newUri: URI;
}

export interface IRuntimeSessionService {
	// Needed for service branding in dependency injector.
	readonly _serviceBrand: undefined;

	// An event that fires when a runtime session is about to start.
	readonly onWillStartSession: Event<IRuntimeSessionWillStartEvent>;

	// An event that fires when a runtime session starts.
	readonly onDidStartRuntime: Event<ILanguageRuntimeSession>;

	// An event that fires when a runtime fails to start.
	readonly onDidFailStartRuntime: Event<ILanguageRuntimeSession>;

	// An event that fires when a runtime changes state.
	readonly onDidChangeRuntimeState: Event<ILanguageRuntimeSessionStateEvent>;

	// An event that fires when a runtime receives a global event.
	readonly onDidReceiveRuntimeEvent: Event<ILanguageRuntimeGlobalEvent>;

	// An event that fires when the active runtime changes.
	readonly onDidChangeForegroundSession: Event<ILanguageRuntimeSession | undefined>;

	readonly onDidDeleteRuntimeSession: Event<string>;

	// An event that fires when a notebook session's URI is updated.
	readonly onDidUpdateNotebookSessionUri: Event<INotebookSessionUriChangedEvent>;

	/**
	 * Gets the active runtime sessions
	 */
	readonly activeSessions: ILanguageRuntimeSession[];

	/**
	 * Register a session manager.
	 */
	registerSessionManager(manager: ILanguageRuntimeSessionManager): IDisposable;

	/**
	 * Gets a specific runtime session by session identifier.
	 */
	getSession(sessionId: string): ILanguageRuntimeSession | undefined;

	/**
	 * Gets a currently active session for a runtime.
	 */
	getActiveSession(sessionId: string): ActiveRuntimeSession | undefined;

	/**
	 * Gets a specific runtime console by runtime identifier. Currently, only
	 * one console can exist per runtime ID.
	 */
	getConsoleSessionForRuntime(runtimeId: string): ILanguageRuntimeSession | undefined;

	/**
	 * Gets a specific runtime console by language identifier. Currently, only
	 * one console can exist per language ID.
	 */
	getConsoleSessionForLanguage(languageId: string): ILanguageRuntimeSession | undefined;

	/**
	 * Gets a specific notebook session by notebook URI. Currently, only one
	 * notebook session can exist per notebook URI.
	 */
	getNotebookSessionForNotebookUri(notebookUri: URI): ILanguageRuntimeSession | undefined;

	/**
	 * List all active runtime sessions.
	 */
	getActiveSessions(): ActiveRuntimeSession[];

	/**
	 * Checks for a starting or running console for the given language ID.
	 *
	 * @param languageId The language ID to check for; if undefined, checks for
	 * 	any starting or running console.
	 */
	hasStartingOrRunningConsole(languageId?: string | undefined): boolean;

	/**
	 * Gets or sets the active foreground runtime session, if any.
	 */
	foregroundSession: ILanguageRuntimeSession | undefined;

	/**
	 * Starts a new session for a runtime. Use to start a new runtime at the
	 * behest of a user gesture.
	 *
	 * @param runtimeId The runtime identifier of the runtime to start.
	 * @param sessionName A human-readable (displayed) name for the session to start.
	 * @param sessionMode The mode of the session to start.
	 * @param source The source of the request to start the runtime, for debugging purposes
	 *  (not displayed to the user)
	 * @param startMode The mode in which to start the runtime.
	 * @param activate Whether to activate/focus the session after it is
	 * started.
	 *
	 * Returns a promise that resolves to the session ID of the new session.
	 */
	startNewRuntimeSession(runtimeId: string,
		sessionName: string,
		sessionMode: LanguageRuntimeSessionMode,
		notebookUri: URI | undefined,
		source: string,
		startMode: RuntimeStartMode,
		activate: boolean): Promise<string>;

	/**
	 * Validates a persisted runtime session before reconnecting to it.
	 *
	 * @param runtimeMetadata The metadata of the runtime.
	 * @param sessionId The ID of the session to validate.
	 */
	validateRuntimeSession(
		runtimeMetadata: ILanguageRuntimeMetadata,
		sessionId: string): Promise<boolean>;

	/**
	 * Restores (reconnects to) a runtime session that was previously started.
	 *
	 * @param runtimeMetadata The metadata of the runtime to start.
	 * @param sessionMetadata The metadata of the session to start.
	 * @param activate Whether to activate/focus the session after it is reconnected.
	 */
	restoreRuntimeSession(
		runtimeMetadata: ILanguageRuntimeMetadata,
		sessionMetadata: IRuntimeSessionMetadata,
		activate: boolean): Promise<void>;

	/**
	 * Automatically starts a runtime.
	 *
	 * @param runtime The runtime to start.
	 * @param source The source of the request to start the runtime.
	 * @param activate Whether to activate/focus the session after it is
	 * started.
	 *
	 * @returns A promise that resolves with a session ID for the new session,
	 * if one was started.
	 */
	autoStartRuntime(
		metadata: ILanguageRuntimeMetadata,
		source: string,
		activate: boolean): Promise<string>;

	/**
	 * Selects a previously registered runtime as the active runtime.
	 *
	 * @param runtimeId The identifier of the runtime to select.
	 * @param source The source of the request to select the runtime, for debugging purposes.
	 * @param notebookUri The URI of the notebook selecting the runtime, if any.
	 */
	selectRuntime(runtimeId: string, source: string, notebookUri?: URI): Promise<void>;

	deleteSession(sessionId: string): Promise<void>;

	/**
	 * Focus the runtime session by making it the foreground session if it's
	 * a console session.
	 *
	 * @param sessionId The identifier of the session to focus.
	 */
	focusSession(sessionId: string): void;

	/**
	 * Restart a runtime session.
	 *
	 * @param sessionId The identifier of the session to restart.
	 * @param source The source of the request to restart the session, for debugging purposes.
	 */
	restartSession(sessionId: string, source: string): Promise<void>;

	/**
	 * Interrupt a runtime session.
	 *
	 * @param sessionId The identifier of the session to interrupt.
	 */
	interruptSession(sessionId: string): Promise<void>;

	/**
	 * Shutdown a runtime session for a notebook.
	 *
	 * @param notebookUri The notebook's URI.
	 * @param exitReason The reason for exiting.
	 * @param source The source of the request to shutdown the session, for debugging purposes.
	 * @returns A promise that resolves when the session has exited.
	 */
	shutdownNotebookSession(notebookUri: URI, exitReason: RuntimeExitReason, source: string): Promise<void>;

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
	 * Implementation notes:
	 * - Concurrency: Operations are ordered specifically to handle concurrent access safely.
	 *   We first add the new mapping before removing the old one, ensuring the session is
	 *   always accessible even if interrupted mid-operation.
	 *
	 * - URI Validation: Both URIs need to be valid, and oldUri must map to an active session.
	 *   We check that the session isn't terminated before attempting the transfer.
	 *
	 * - Error Handling: If something goes wrong after adding the new mapping but before
	 *   removing the old one, the session will be accessible via both URIs - not ideal
	 *   but better than losing access completely.
	 *
	 * @param oldUri The original URI of the notebook (typically an untitled:// URI)
	 * @param newUri The new URI of the notebook (typically a file:// URI after saving)
	 * @returns The session ID of the updated session, or undefined if no update occurred
	 */
	updateNotebookSessionUri(oldUri: URI, newUri: URI): string | undefined;

	/**
	 * Updates the active languages with the update service. This has to be pushed to the update
	 * service since it is in the platform layer.z
	 *
	 */
	updateActiveLanguages(): void;
}

export { RuntimeClientType };

export type { IRuntimeClientInstance };

