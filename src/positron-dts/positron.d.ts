/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
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
		ShowHelpUrl = 'show_help_url',
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
		/** A unique identifier for this runtime */
		id: string;

		/** The language identifier for this runtime. */
		language: string;

		/** The name of the runtime. */
		name: string;

		/** The version of the runtime. */
		version: string;
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
