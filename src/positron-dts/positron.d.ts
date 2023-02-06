/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

declare module 'positron' {

	import * as vscode from 'vscode'; // eslint-disable-line

	/**
	 * The current Positron version.
	 */
	export const version: string;

	/** The set of possible language runtime messages */
	export enum LanguageRuntimeMessageType {
		/** A message representing output (text, plots, etc.) */
		Output = 'output',

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
	}

	/** begin positron-language-runtime-event-type */
	export enum LanguageRuntimeEventType {
		Busy = 'busy',
		ShowMessage = 'show_message',
		ShowHelp = 'show_help',
	}
	/** end positron-language-runtime-event-type */

	/**
	 * The set of possible statuses for a language runtime while online
	 */
	export enum RuntimeOnlineState {
		/** The runtime is ready to execute code. */
		Idle = 'idle',

		/** The runtime is busy executing code. */
		Busy = 'busy',
	}

	/**
	 * The set of possible statuses for a language runtime
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
	 * LanguageRuntimeMessage is an interface that defines an event occurring in a
	 * language runtime, such as outputting text or plots.
	 */
	export interface LanguageRuntimeMessage {
		/** The event ID */
		id: string;

		/** The ID of this event's parent (the event that caused it), if applicable */
		parent_id: string;

		/** The message's date and time, in ISO 8601 format */
		when: string;

		/** The type of event */
		type: LanguageRuntimeMessageType;
	}

	export interface LanguageRuntimeEventData { }

	/**
	 * LanguageRuntimeEvent is an interface that defines an event occurring
	 * in a language runtime, usually to trigger some action on the front end.
	 */
	export interface LanguageRuntimeEvent extends LanguageRuntimeMessage {
		/** The name of the event */
		name: LanguageRuntimeEventType;

		/** The event's data */
		data: LanguageRuntimeEventData;
	}

	/** LanguageRuntimeOutput is a LanguageRuntimeMessage representing output (text, plots, etc.) */
	export interface LanguageRuntimeOutput extends LanguageRuntimeMessage {
		/** A map of data MIME types to the associated data, e.g. `text/plain` => `'hello world'` */
		data: Map<string, string>;
	}

	/** LanguageRuntimeInput is a LanguageRuntimeMessage representing echoed user input */
	export interface LanguageRuntimeInput extends LanguageRuntimeMessage {
		/** The code that was input */
		code: string;

		/** The execution count */
		execution_count: number;
	}

	/** LanguageRuntimePrompt is a LanguageRuntimeMessage representing a prompt for input */
	export interface LanguageRuntimePrompt extends LanguageRuntimeMessage {
		/** The prompt text */
		prompt: string;

		/** Whether this is a password prompt (and typing should be hidden)  */
		password: boolean;
	}

	/** LanguageRuntimeInfo contains metadata about the runtime after it has started. */
	export interface LanguageRuntimeInfo {
		/** A startup banner */
		banner: string;

		/** The implementation version number */
		implementation_version: string;

		/** The language version number */
		language_version: string;
	}

	/** LanguageRuntimeState is a LanguageRuntimeMessage representing a new runtime state */
	export interface LanguageRuntimeState extends LanguageRuntimeMessage {
		/** The new state */
		state: RuntimeOnlineState;
	}

	/** LanguageRuntimeError is a LanguageRuntimeMessage that represents a run-time error */
	export interface LanguageRuntimeError extends LanguageRuntimeMessage {
		/** The error name */
		name: string;

		/** The error message */
		message: string;

		/** The error stack trace */
		traceback: Array<string>;
	}

	/** LanguageRuntimeMetadata contains information about a language runtime that is known
	 * before the runtime is started.
	 */
	export interface LanguageRuntimeMetadata {
		/** A unique identifier for this runtime; takes the form of a GUID */
		runtimeId: string;

		/** The name of the runtime displayed to the user; e.g. "R 4.2 (64-bit)" */
		runtimeName: string;

		/** The version of the runtime itself (e.g. kernel or extension version) as a string; e.g. "0.1" */
		runtimeVersion: string;

		/** The free-form, user-friendly name of the language this runtime can execute; e.g. "R" */
		languageName: string;

		/**
		 * The Visual Studio Code Language ID of the language this runtime can execute; e.g. "r"
		 *
		 * See here for a list of known language IDs:
		 * https://code.visualstudio.com/docs/languages/identifiers#_known-language-identifiers
		 */
		languageId: string;

		/** The version of the language; e.g. "4.2" */
		languageVersion: string;

		/** Whether the runtime should start up automatically or wait until explicitly requested */
		startupBehavior: LanguageRuntimeStartupBehavior;
	}

	export enum LanguageRuntimeStartupBehavior {
		/** The runtime should start automatically; usually used for runtimes that provide LSPs */
		Implicit = 'implicit',

		/** The runtime should start when the user explicitly requests it; usually used for runtimes that only provide REPLs */
		Explicit = 'explicit',
	}

	/**
	 * The set of client types that can be generated by a language runtime
	 */
	export enum RuntimeClientType {
		Environment = 'environment',

		// Future client types may include:
		// - Data viewer window
		// - Watch window/variable explorer
		// - Code inspector
		// - etc.
	}

	/**
	 * The possible states for a language runtime client instance. These
	 * represent the state of the communications channel between the client and
	 * the runtime.
	 */
	export enum RuntimeClientState {
		/** The client has not yet been initialized */
		Uninitialized = 'uninitialized',

		/** The connection between the server and the client is being opened */
		Opening = 'opening',

		/** The connection between the server and the client has been established */
		Connected = 'connected',

		/** The connection between the server and the client is being closed */
		Closing = 'closing',

		/** The connection between the server and the client is closed */
		Closed = 'closed',
	}

	/**
	 * An instance of a client widget generated by a language runtime. See
	 * RuntimeClientType for the set of possible client types.
	 *
	 * The client is responsible for disposing itself when it is no longer
	 * needed; this will trigger the closure of the communications channel
	 * between the client and the runtime.
	 */
	export interface RuntimeClientInstance extends vscode.Disposable {
		onDidChangeClientState: vscode.Event<RuntimeClientState>;
		getClientState(): RuntimeClientState;
		getClientId(): string;
		getClientType(): RuntimeClientType;
	}

	/**
	 * RuntimeEnvironmentClient is a client that tracks the current environment
	 * variables in the runtime.
	 */
	export interface RuntimeEnvironmentClient extends RuntimeClientInstance {
		onDidChangeEnvironmentVariables: vscode.Event<Array<EnvironmentVariable>>;
		getCurrentEnvironmentVariables(): Array<EnvironmentVariable>;
	}

	export interface EnvironmentVariable {
		name: string;
		value: string;
		length: number;
		size: number;
	}

	/**
	 * LanguageRuntime is an interface implemented by extensions that provide a
	 * set of common tools for interacting with a language runtime, such as code
	 * execution, LSP implementation, and plotting.
	 */
	export interface LanguageRuntime {
		/** An object supplying metadata about the runtime */
		readonly metadata: LanguageRuntimeMetadata;

		/** An object that emits language runtime events */
		onDidReceiveRuntimeMessage: vscode.Event<LanguageRuntimeMessage>;

		/** An object that emits he current state of the runtime */
		onDidChangeRuntimeState: vscode.Event<RuntimeState>;

		/** Execute code in the runtime */
		execute(code: string,
			id: string,
			mode: RuntimeCodeExecutionMode,
			errorBehavior: RuntimeErrorBehavior): void;

		/** Test a code fragment for completeness */
		isCodeFragmentComplete(code: string): Thenable<RuntimeCodeFragmentStatus>;

		/**
		 * Create a new instance of a client; return null if the client type
		 * is not supported by this runtime, or a string containing the ID of
		 * the client if it is supported.
		 */
		createClient(type: RuntimeClientType): string;

		/** Remove an instance of a client (created with `createClient`) */
		removeClient(id: string): void;

		/** Send a message to the server end of a client instance */
		sendClientMessage(id: string, message: any): void;

		/** Reply to a prompt issued by the runtime */
		replyToPrompt(id: string, reply: string): void;

		/** Start the runtime; returns a Thenable that resolves with information about the runtime. */
		start(): Thenable<LanguageRuntimeInfo>;

		/** Interrupt the runtime */
		interrupt(): void;

		/** Restart the runtime */
		restart(): void;

		/** Shut down the runtime */
		shutdown(): void;
	}

	namespace runtime {
		export function registerLanguageRuntime(runtime: LanguageRuntime): vscode.Disposable;
	}
}
