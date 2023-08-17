/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IRuntimeClientInstance, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { IRuntimeClientEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeFrontEndClient';

export const ILanguageRuntimeService = createDecorator<ILanguageRuntimeService>('languageRuntimeService');

/**
 * Formats a language runtime for logging.
 * @param languageRuntime The language runtime to format for logging.
 * @returns A string suitable for logging the language runtime.
 */
export const formatLanguageRuntime = (languageRuntime: ILanguageRuntime) =>
	`${languageRuntime.metadata.runtimeId} (language: ${languageRuntime.metadata.languageName} name: ${languageRuntime.metadata.runtimeName} version: ${languageRuntime.metadata.languageVersion})`;

/**
 * LanguageRuntimeMessage is an interface that defines an event occurring in a
 * language runtime, such as outputting text or plots.
 */
export interface ILanguageRuntimeMessage {
	/** The event ID */
	id: string;

	/** The type of event */
	type: LanguageRuntimeMessageType;

	/** The event clock time at which the event occurred */
	event_clock: number;

	/** The ID of this event's parent (the event that caused it), if applicable */
	parent_id: string;

	/** The message's date and time, in ISO 8601 format */
	when: string;
}


/** LanguageRuntimeOutput is a LanguageRuntimeMessage representing output (text, plots, etc.) */
export interface ILanguageRuntimeMessageOutput extends ILanguageRuntimeMessage {
	/** A record of data MIME types to the associated data, e.g. `text/plain` => `'hello world'` */
	readonly data: Record<string, string>;
}

/**
 * ILanguageRuntimeMessageStream is a LanguageRuntimeMessage representing text
 * emitted on one of the standard streams (stdout or stderr)
 */
export interface ILanguageRuntimeMessageStream extends ILanguageRuntimeMessage {
	/** The stream name */
	name: 'stdout' | 'stderr';

	/** The text emitted from the stream */
	text: string;
}

/** ILanguageRuntimeInput is a ILanguageRuntimeMessage representing echoed user input */
export interface ILanguageRuntimeMessageInput extends ILanguageRuntimeMessage {
	/** The code that was input */
	code: string;

	/** The execution count */
	execution_count: number;
}

/** LanguageRuntimePrompt is a LanguageRuntimeMessage representing a prompt for input */
export interface ILanguageRuntimeMessagePrompt extends ILanguageRuntimeMessage {
	/** The prompt text */
	prompt: string;

	/** Whether this is a password prompt (and typing should be hidden)  */
	password: boolean;
}

/** ILanguageRuntimeMessageCommOpen is a LanguageRuntimeMessage representing a comm open request */
export interface ILanguageRuntimeMessageCommOpen extends ILanguageRuntimeMessage {
	/** The comm ID */
	comm_id: string;

	/** The target name of the comm to open, e.g. 'jupyter.widget' */
	target_name: string;

	/** Data associated with the request (e.g. parameters to client-side comm constructor) */
	data: object;
}

/** ILanguageRuntimeMessageCommData is a LanguageRuntimeMessage representing data received from a comm */
export interface ILanguageRuntimeMessageCommData extends ILanguageRuntimeMessage {
	/** The comm ID */
	comm_id: string;

	/** The data received from the comm */
	data: object;
}

/**
 * ILanguageRuntimeMessageCommClosed is a LanguageRuntimeMessage indicating the
 * closure of a comm from the server side
 */
export interface ILanguageRuntimeMessageCommClosed extends ILanguageRuntimeMessage {
	/** The comm ID */
	comm_id: string;

	/** The shutdown data received from the comm, if any */
	data: object;
}

/**
 * ILanguageRuntimeClientCreatedEvent is an event indicating that a client has
 * been created for a comm open request.
 */
export interface ILanguageRuntimeClientCreatedEvent {
	/** The message that created the client */
	message: ILanguageRuntimeMessageCommOpen;

	/** The client that was created */
	client: IRuntimeClientInstance<any, any>;
}

/**
 * The set of possible statuses for a language runtime. Note that this includes
 * the `Restarting`, `Interrupting`, and `Exiting` states, which are not present
 * in at the API layer (in `positron.d.ts`). These states are used internally by
 * the language runtime service to track in-flight requests to change the
 * runtime's state, and are not emitted by the runtime itself.
 */
export enum RuntimeState {
	/** The runtime has not been started or initialized yet. */
	Uninitialized = 'uninitialized',

	/** The runtime is initializing (preparing to start). */
	Initializing = 'initializing',

	/** The runtime is in the process of starting up. It isn't ready for messages. */
	Starting = 'starting',

	/** The runtime has a heartbeat and is ready for messages. */
	Ready = 'ready',

	/** The runtime is ready to execute code. */
	Idle = 'idle',

	/** The runtime is busy executing code. */
	Busy = 'busy',

	/** The runtime is in the process of restarting. */
	Restarting = 'restarting',

	/** The runtime is in the process of shutting down. */
	Exiting = 'exiting',

	/** The runtime's host process has ended. */
	Exited = 'exited',

	/** The runtime is not responding to heartbeats and is presumed offline. */
	Offline = 'offline',

	/** The user has interrupted a busy runtime, but the runtime is not idle yet. */
	Interrupting = 'interrupting',
}

/**
 * Possible code execution modes for a language runtime
 */
export enum RuntimeCodeExecutionMode {
	/** The code was entered interactively, and should be executed and stored in the runtime's history. */
	Interactive = 'interactive',

	/** The code should be executed but not stored in history. */
	Transient = 'transient',

	/** The code execution should be fully silent, neither displayed to the user nor stored in history. */
	Silent = 'silent'
}

/** LanguageRuntimeInfo contains metadata about the runtime after it has started. */
export interface ILanguageRuntimeInfo {
	/** A startup banner */
	banner: string;

	/** The implementation version number */
	implementation_version: string;

	/** The language version number */
	language_version: string;

	/** Custom input prompt, if any */
	input_prompt?: string;

	/** Custom continuation prompt, if any */
	continuation_prompt?: string;
}

/** LanguageRuntimeInfo contains metadata about the runtime after it has started. */
export interface ILanguageRuntimeStartupFailure {
	/** The error message to show to the user; at most one line of text */
	message: string;

	/** Error details, logs, etc. as a multi-line string */
	details: string;
}

/**
 * Possible error dispositions for a language runtime
 */
export enum RuntimeErrorBehavior {
	/** The runtime should stop when an error is encountered. */
	Stop = 'stop',

	/** The runtime should continue execution when an error is encountered */
	Continue = 'continue',
}

/**
 * Results of analyzing code fragment for completeness
 */
export enum RuntimeCodeFragmentStatus {
	/** The code fragment is complete: it is a valid, self-contained expression */
	Complete = 'complete',

	/** The code is incomplete: it is an expression that is missing elements or operands, such as "1 +" or "foo(" */
	Incomplete = 'incomplete',

	/** The code is invalid: an expression that cannot be parsed because of a syntax error */
	Invalid = 'invalid',

	/** It was not possible to ascertain the code fragment's status */
	Unknown = 'unknown'
}

export enum RuntimeOnlineState {
	/** The runtime is starting up */
	Starting = 'starting',

	/** The runtime is currently processing an instruction or code fragment */
	Busy = 'busy',

	/** The runtime is idle */
	Idle = 'idle',
}

/** The set of possible language runtime messages */
export enum LanguageRuntimeMessageType {
	/** A message representing output (text, plots, etc.) */
	Output = 'output',

	/** A message representing output from one of the standard streams (stdout or stderr) */
	Stream = 'stream',

	/** A message representing echoed user input */
	Input = 'input',

	/** A message representing an error that occurred while executing user code */
	Error = 'error',

	/** A message representing a prompt for user input */
	Prompt = 'prompt',

	/** A message representing a change in the runtime's online state */
	State = 'state',

	/** A message representing a runtime event */
	Event = 'event',

	/** A message representing a new comm (client instance) being opened from the runtime side */
	CommOpen = 'comm_open',

	/** A message representing data received via a comm */
	CommData = 'comm_data',

	/** A message indicating that a comm (client instance) was closed from the server side */
	CommClosed = 'comm_closed',
}

export enum LanguageRuntimeStartupBehavior {
	/**
	 * The runtime should be started immediately after registration; usually used for runtimes
	 * that are affiliated with the current workspace.
	 */
	Immediate = 'immediate',

	/**
	 * The runtime should start automatically; usually used for runtimes that provide LSPs
	 */
	Implicit = 'implicit',

	/**
	 * The runtime should start when the user explicitly requests it;
	 * usually used for runtimes that only provide REPLs
	 */
	Explicit = 'explicit',
}

export enum LanguageRuntimeDiscoveryPhase {
	/**
	 * We are waiting for extensions to register language runtime providers.
	 */
	AwaitingExtensions = 'AwaitingExtensions',

	/**
	 * Language runtimes are currently being discovered and registered. During
	 * this phase, the service emits `onDidRegisterRuntime` events as it
	 * discovers new runtimes.
	 */
	Discovering = 'discovering',

	/**
	 * Language runtime discovery has completed.
	 */
	Complete = 'complete',
}

export interface ILanguageRuntimeMessageState extends ILanguageRuntimeMessage {
	/** The new state */
	state: RuntimeOnlineState;
}

export interface ILanguageRuntimeMessageError extends ILanguageRuntimeMessage {
	/** The error name */
	name: string;

	/** The error message */
	message: string;

	/** The error stack trace */
	traceback: Array<string>;
}

export interface ILanguageRuntimeGlobalEvent {
	/** The ID of the runtime from which the event originated */
	runtime_id: string;

	/** The event itself */
	event: IRuntimeClientEvent;
}

export interface ILanguageRuntimeStateEvent {
	/** The ID of the runtime that changed states */
	runtime_id: string;

	/** The runtime's previous state */
	old_state: RuntimeState;

	/** The runtime's new state */
	new_state: RuntimeState;
}

/* ILanguageRuntimeMetadata contains information about a language runtime that is known
 * before the runtime is started.
 */
export interface ILanguageRuntimeMetadata {
	/** The path to the kernel. */
	readonly runtimePath: string;

	/** A unique identifier for this runtime; usually a GUID */
	readonly runtimeId: string;

	/** The name of the language that this runtime can execute; e.g. "R" */
	readonly languageName: string;

	/** The internal ID of the language that this runtime can execute; e.g. "r" */
	readonly languageId: string;

	/** The version of the language in question; e.g. "4.3.3" */
	readonly languageVersion: string;

	/** The Base64-encoded icon SVG for the language. */
	readonly base64EncodedIconSvg: string | undefined;

	/** The user-facing descriptive name of the runtime; e.g. "R 4.3.3" */
	readonly runtimeName: string;

	/** The internal version of the runtime that wraps the language; e.g. "1.0.3" */
	readonly runtimeVersion: string;

	/** The runtime's source or origin; e.g. PyEnv, System, Homebrew, Conda, etc. */
	readonly runtimeSource: string;

	/** Whether the runtime should start up automatically or wait until explicitly requested */
	readonly startupBehavior: LanguageRuntimeStartupBehavior;

	/** FIXME
	 * These are for compatibility until runtimes have added
		 * support for the dynamic state struct */
	readonly inputPrompt?: string;
	readonly continuationPrompt?: string;
}

/* ILanguageRuntimeConfig contains information about a language runtime that is known
 * after the runtime is started and that might change in the course of a session.
 */
export interface ILanguageRuntimeDynState {
	/** The text the language's interpreter uses to prompt the user for input, e.g. ">" or ">>>" */
	inputPrompt: string;

	/** The text the language's interpreter uses to prompt the user for continued input, e.g. "+" or "..." */
	continuationPrompt: string;
}

export interface ILanguageRuntime {
	/** The language runtime's static metadata */
	readonly metadata: ILanguageRuntimeMetadata;

	/** The language runtime's dynamic metadata */
	dynState: ILanguageRuntimeDynState;

	/** An object that emits events when the runtime state changes */
	onDidChangeRuntimeState: Event<RuntimeState>;

	/** An object that emits an event when the runtime completes startup */
	onDidCompleteStartup: Event<ILanguageRuntimeInfo>;

	/** An object that emits an event when runtime startup fails */
	onDidEncounterStartupFailure: Event<ILanguageRuntimeStartupFailure>;

	/**
	 * An object that emits an event when a client instance (comm) is created
	 * from the runtime side. Note that this only fires when an instance is
	 * created from the runtime side; it does not fire when
	 * `createClient` is called from the front end.
	 */
	onDidCreateClientInstance: Event<ILanguageRuntimeClientCreatedEvent>;

	onDidReceiveRuntimeMessageOutput: Event<ILanguageRuntimeMessageOutput>;
	onDidReceiveRuntimeMessageStream: Event<ILanguageRuntimeMessageStream>;
	onDidReceiveRuntimeMessageInput: Event<ILanguageRuntimeMessageInput>;
	onDidReceiveRuntimeMessageError: Event<ILanguageRuntimeMessageError>;
	onDidReceiveRuntimeMessagePrompt: Event<ILanguageRuntimeMessagePrompt>;
	onDidReceiveRuntimeMessageState: Event<ILanguageRuntimeMessageState>;
	onDidReceiveRuntimeMessagePromptConfig: Event<void>;

	/** The current state of the runtime (tracks events above) */
	getRuntimeState(): RuntimeState;

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
	 */
	createClient<T, U>(type: RuntimeClientType, params: any):
		Thenable<IRuntimeClientInstance<T, U>>;

	/** Get a list of all known clients */
	listClients(type?: RuntimeClientType): Thenable<Array<IRuntimeClientInstance<any, any>>>;

	/** Reply to an input prompt that the runtime issued
	 * (via a LanguageRuntimePrompt message)
	 */
	replyToPrompt(id: string, value: string): void;

	start(): Thenable<ILanguageRuntimeInfo>;

	/** Interrupt the runtime */
	interrupt(): void;

	/** Restart the runtime */
	restart(): void;

	/** Shut down the runtime */
	shutdown(): void;
}

export interface ILanguageRuntimeService {
	// Needed for service branding in dependency injector.
	readonly _serviceBrand: undefined;

	// An event that fires when the language runtime discovery phase changes.
	readonly onDidChangeDiscoveryPhase: Event<LanguageRuntimeDiscoveryPhase>;

	// An event that fires when a new runtime is registered.
	readonly onDidRegisterRuntime: Event<ILanguageRuntime>;

	// An event that fires when a runtime is about to start.
	readonly onWillStartRuntime: Event<ILanguageRuntime>;

	// An event that fires when a runtime starts.
	readonly onDidStartRuntime: Event<ILanguageRuntime>;

	// An event that fires when a runtime fails to start.
	readonly onDidFailStartRuntime: Event<ILanguageRuntime>;

	// An event that fires when a runtime is reconnected.
	readonly onDidReconnectRuntime: Event<ILanguageRuntime>;

	// An event that fires when a runtime changes state.
	readonly onDidChangeRuntimeState: Event<ILanguageRuntimeStateEvent>;

	// An event that fires when a runtime receives a global event.
	readonly onDidReceiveRuntimeEvent: Event<ILanguageRuntimeGlobalEvent>;

	// An event that fires when the active runtime changes.
	readonly onDidChangeActiveRuntime: Event<ILanguageRuntime | undefined>;

	/**
	 * Gets the running language runtimes.
	 */
	readonly runningRuntimes: ILanguageRuntime[];

	/**
	 * Gets the registered language runtimes.
	 */
	readonly registeredRuntimes: ILanguageRuntime[];

	/**
	 * Gets or sets the active language runtime.
	 */
	activeRuntime: ILanguageRuntime | undefined;

	/**
	 * Register a new language runtime
	 * @param runtime The LanguageRuntime to register
	 * @param startupBehavior The desired startup behavior for the runtime
	 * @returns A disposable that can be used to unregister the runtime
	 */
	registerRuntime(runtime: ILanguageRuntime, startupBehavior: LanguageRuntimeStartupBehavior): IDisposable;

	/**
	 * Signal that discovery of language runtimes is complete.
	 */
	completeDiscovery(): void;

	/**
	 * Returns a specific runtime by runtime identifier.
	 * @param runtimeId The runtime identifier of the runtime to retrieve.
	 * @returns The runtime with the given runtime identifier, or undefined if
	 * no runtime with the given runtime identifier exists.
	 */
	getRuntime(runtimeId: string): ILanguageRuntime | undefined;

	/**
	 * Starts a runtime.
	 * @param runtimeId The runtime identifier of the runtime to start.
	 * @param source The source of the request to start the runtime, for debugging purposes
	 *  (not displayed to the user)
	 */
	startRuntime(runtimeId: string, source: string): Promise<void>;
}
export { RuntimeClientType, IRuntimeClientInstance };
