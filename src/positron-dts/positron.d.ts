/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'positron' {

	import * as vscode from 'vscode';

	/**
	 * The current Positron version. This is the Positron calendar version, e.g. "2028.10.2"
	 */
	export const version: string;

	/**
	 * The Positron build number. This is a monotonically increasing number that uniquely
	 * identifies a build of Positron within a release.
	 */
	export const buildNumber: number;

	/** The set of possible language runtime messages */
	export enum LanguageRuntimeMessageType {
		/** A message instructing the frontend to clear the output of a runtime execution. */
		ClearOutput = 'clear_output',

		/** A message representing output (text, plots, etc.) */
		Output = 'output',

		/** A message representing the computational result of a runtime execution */
		Result = 'result',

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

		/** A message representing data received via a comm (to a client instance) */
		CommData = 'comm_data',

		/** A message indicating that a comm (client instance) was closed from the server side */
		CommClosed = 'comm_closed',

		/** A message that should be handled by an IPyWidget */
		IPyWidget = 'ipywidget',
	}

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
	 * Possible reasons a language runtime could exit.
	 */
	export enum RuntimeExitReason {
		/** The runtime exited because it could not start correctly. */
		StartupFailed = 'startupFailed',

		/** The runtime is shutting down at the request of the user. */
		Shutdown = 'shutdown',

		/** The runtime exited because it was forced to quit. */
		ForcedQuit = 'forcedQuit',

		/** The runtime is exiting in order to restart. */
		Restart = 'restart',

		/** The runtime is exiting in order to switch to a new runtime. */
		SwitchRuntime = 'switchRuntime',

		/** The runtime exited because of an error, most often a crash. */
		Error = 'error',

		/**
		 * The runtime exited for an unknown reason. This typically means that
		 * it exited unexpectedly but with a normal exit code (0).
		 */
		Unknown = 'unknown',
	}

	/**
	 * LanguageRuntimeExit is an interface that defines an event occurring when a
	 * language runtime exits.
	 */
	export interface LanguageRuntimeExit {
		/** Runtime name */
		runtime_name: string;

		/**
		 * The process exit code, if the runtime is backed by a process. If the
		 * runtime is not backed by a process, this should just be 0 for a
		 * succcessful exit and 1 for an error.
		 */
		exit_code: number;

		/**
		 * The reason the runtime exited.
		 */
		reason: RuntimeExitReason;

		/** The exit message, if any. */
		message: string;
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

		/** Additional metadata, if any */
		metadata?: Map<any, any>;

		/** Additional binary data, if any */
		buffers?: Array<Uint8Array>;
	}

	/**
	 * LanguageRuntimeClearOutput is a LanguageRuntimeMessage instructing the frontend to clear the
	 * output of a runtime execution. */
	export interface LanguageRuntimeClearOutput extends LanguageRuntimeMessage {
		/** Wait to clear the output until new output is available. */
		wait: boolean;
	}

	/** LanguageRuntimeOutput is a LanguageRuntimeMessage representing output (text, plots, etc.) */
	export interface LanguageRuntimeOutput extends LanguageRuntimeMessage {
		/** A record of data MIME types to the associated data, e.g. `text/plain` => `'hello world'` */
		data: Record<string, any>;
	}

	/**
	 * LanguageRuntimeResult is a LanguageRuntimeOutput representing the computational result of a
	 * runtime execution.
	 */
	export interface LanguageRuntimeResult extends LanguageRuntimeOutput {
	}

	/**
	 * The set of possible output locations for a LanguageRuntimeOutput.
	 */
	export enum PositronOutputLocation {
		/** The output should be displayed inline in Positron's Console */
		Console = 'console',

		/** The output should be displayed in Positron's Viewer pane */
		Viewer = 'viewer',

		/** The output should be displayed in Positron's Plots pane */
		Plot = 'plot',
	}

	/**
	 * LanguageRuntimeWebOutput amends LanguageRuntimeOutput with additional information needed
	 * to render web content in Positron.
	 */
	export interface LanguageRuntimeWebOutput extends LanguageRuntimeOutput {
		/** Where the web output should be displayed */
		output_location: PositronOutputLocation;

		/** The set of resource roots needed to display the output */
		resource_roots: vscode.Uri[];
	}

	/**
	 * The set of standard stream names supported for streaming textual output.
	 */
	export enum LanguageRuntimeStreamName {
		Stdout = 'stdout',
		Stderr = 'stderr'
	}

	/**
	 * LanguageRuntimeStream is a LanguageRuntimeMessage representing output from a standard stream
	 * (stdout or stderr).
	 */
	export interface LanguageRuntimeStream extends LanguageRuntimeMessage {
		/** The stream name */
		name: LanguageRuntimeStreamName;

		/** The stream's text */
		text: string;
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

		/** Initial prompt string in case user customized it */
		input_prompt?: string;

		/** Continuation prompt string in case user customized it */
		continuation_prompt?: string;
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

	/**
	 * LanguageRuntimeMessageIPyWidget is a wrapped LanguageRuntimeMessage that should be handled
	 * by an IPyWidget.
	 *
	 * Output widgets may intercept replies to an execution and instead render them inside the
	 * output widget. See https://ipywidgets.readthedocs.io/en/latest/examples/Output%20Widget.html
	 * for more.
	 */
	export interface LanguageRuntimeMessageIPyWidget extends LanguageRuntimeMessage {
		/** The original runtime message that was intercepted by an IPyWidget */
		original_message: LanguageRuntimeMessage;
	}

	/**
	 * LanguageRuntimeCommOpen is a LanguageRuntimeMessage that indicates a
	 * comm (client instance) was opened from the server side
	 */
	export interface LanguageRuntimeCommOpen extends LanguageRuntimeMessage {
		/** The unique ID of the comm being opened */
		comm_id: string;

		/** The name (type) of the comm being opened, e.g. 'jupyter.widget' */
		target_name: string;

		/** The data from the back-end */
		data: object;
	}

	/** LanguageRuntimeCommMessage is a LanguageRuntimeMessage that represents data for a comm (client instance) */
	export interface LanguageRuntimeCommMessage extends LanguageRuntimeMessage {
		/** The unique ID of the client comm ID for which the message is intended */
		comm_id: string;

		/** The data from the back-end */
		data: object;
	}

	/**
	 * LanguageRuntimeCommClosed is a LanguageRuntimeMessage that indicates a
	 * comm (client instance) was closed from the server side
	 */
	export interface LanguageRuntimeCommClosed extends LanguageRuntimeMessage {
		/** The unique ID of the client comm ID for which the message is intended */
		comm_id: string;

		/** The data from the back-end */
		data: object;
	}

	/**
	 * LanguageRuntimeMetadata contains information about a language runtime that is known
	 * before the runtime is started.
	 */
	export interface LanguageRuntimeMetadata {
		/** The path to the runtime. */
		runtimePath: string;

		/** A unique identifier for this runtime; takes the form of a GUID */
		runtimeId: string;

		/**
		 * The fully qualified name of the runtime displayed to the user; e.g. "R 4.2 (64-bit)".
		 * Should be unique across languages.
		 */
		runtimeName: string;

		/**
		 * A language specific runtime name displayed to the user; e.g. "4.2 (64-bit)".
		 * Should be unique within a single language.
		 */
		runtimeShortName: string;

		/** The version of the runtime itself (e.g. kernel or extension version) as a string; e.g. "0.1" */
		runtimeVersion: string;

		/** The runtime's source or origin; e.g. PyEnv, System, Homebrew, Conda, etc. */
		runtimeSource: string;

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

		/** The Base64-encoded icon SVG for the language. */
		base64EncodedIconSvg: string | undefined;

		/** Whether the runtime should start up automatically or wait until explicitly requested */
		startupBehavior: LanguageRuntimeStartupBehavior;

		/** Where sessions will be located; used as a hint to control session restoration */
		sessionLocation: LanguageRuntimeSessionLocation;

		/**
		 * Extra data supplied by the runtime provider; not read by Positron but supplied
		 * when creating a new session from the metadata.
		 */
		extraRuntimeData: any;
	}

	export interface RuntimeSessionMetadata {
		/** The ID of this session */
		readonly sessionId: string;

		/** The user-facing name of this session */
		readonly sessionName: string;

		/** The session's mode */
		readonly sessionMode: LanguageRuntimeSessionMode;

		/** The URI of the notebook document associated with the session, if any */
		readonly notebookUri?: vscode.Uri;
	}

	/**
	 * LanguageRuntimeSessionMode is an enum representing the set of possible
	 * modes for a language runtime session.
	 */
	export enum LanguageRuntimeSessionMode {
		/**
		 * The runtime session is bound to a Positron console. Typically,
		 * there's only one console session per language.
		 */
		Console = 'console',

		/** The runtime session backs a notebook. */
		Notebook = 'notebook',

		/** The runtime session is a background session (not attached to any UI). */
		Background = 'background',
	}


	/**
	 * LanguageRuntimeDynState contains information about a language runtime that may
	 * change after a runtime has started.
	 */
	export interface LanguageRuntimeDynState {
		/** The text the language's interpreter uses to prompt the user for input, e.g. ">" or ">>>" */
		inputPrompt: string;

		/** The text the language's interpreter uses to prompt the user for continued input, e.g. "+" or "..." */
		continuationPrompt: string;
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

		/**
		 * The runtime only starts up if manually requested by the user.
		 * The difference from Explicit, is that Manual startup never
		 * starts automatically, even if the run time is affiliated to the
		 * workspace.
		 */
		Manual = 'manual'
	}

	/**
	 * An enumeration of possible locations for runtime sessions.
	 */
	export enum LanguageRuntimeSessionLocation {
		/**
		 * The runtime session is persistent on the machine; it should be
		 * restored when the workspace is re-opened, and may persist across
		 * Positron sessions.
		 */
		Machine = 'machine',

		/**
		 * The runtime session is located in the current workspace (usually a
		 * terminal); it should be restored when the workspace is re-opened in
		 * the same Positron session (e.g. during a browser reload or
		 * reconnect)
		 */
		Workspace = 'workspace',

		/**
		 * The runtime session is browser-only; it should not be restored when the
		 * workspace is re-opened.
		 */
		Browser = 'browser',
	}

	/**
	 * The set of client types that can be generated by a language runtime. Note
	 * that, because client types can share a namespace with other kinds of
	 * widgets, each client type in Positron's API is prefixed with the string
	 * "positron".
	 */
	export enum RuntimeClientType {
		Variables = 'positron.variables',
		Lsp = 'positron.lsp',
		Dap = 'positron.dap',
		Plot = 'positron.plot',
		DataExplorer = 'positron.dataExplorer',
		Ui = 'positron.ui',
		Help = 'positron.help',
		Connection = 'positron.connection',
		Reticulate = 'positron.reticulate',
		IPyWidget = 'jupyter.widget',
		IPyWidgetControl = 'jupyter.widget.control',

		// Future client types may include:
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
	 * The possible types of language model that can be used with the Positron Assistant.
	 */
	export enum PositronLanguageModelType {
		Chat = 'chat',
		Completion = 'completion',
	}

	/**
	 * The possible locations a Positron Assistant chat request can be invoked from.
	 */
	export enum PositronChatAgentLocation {
		Panel = 'panel',
		Terminal = 'terminal',
		Notebook = 'notebook',
		Editor = 'editor',
		EditingSession = 'editing-session',
	}

	/**
	 * A message received from a runtime client instance.
	 */
	export interface RuntimeClientOutput<T> {
		/** The message data */
		data: T;

		/** Raw binary data associated with the message, if any */
		buffers?: Array<Uint8Array>;
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
		onDidSendEvent: vscode.Event<RuntimeClientOutput<object>>;
		performRpcWithBuffers<T>(data: object): Thenable<RuntimeClientOutput<T>>;
		performRpc<T>(data: object): Thenable<T>;
		getClientState(): RuntimeClientState;
		getClientId(): string;
		getClientType(): RuntimeClientType;
	}

	/**
	 * RuntimeVariablesClient is a client that tracks the variables in the runtime.
	 */
	export interface RuntimeVariablesClient extends RuntimeClientInstance {
		onDidChangeVariables: vscode.Event<Array<Variable>>;
		getCurrentVariables(): Array<Variable>;
	}

	export interface Variable {
		name: string;
		value: string;
		length: number;
		size: number;
	}

	export interface LanguageRuntimeManager {
		/**
		 * Returns a generator that yields metadata about all the language
		 * runtimes that are available to the user.
		 *
		 * This metadata will be passed to `createSession` to create new runtime
		 * sessions.
		 */
		discoverAllRuntimes(): AsyncGenerator<LanguageRuntimeMetadata>;

		/**
		 * Returns a single runtime metadata object representing the runtime
		 * that should be used in the current workspace, if any.
		 *
		 * Note that this is called before `discoverAllRuntimes` during
		 * startup, and should return `undefined` if no runtime is recommended.
		 *
		 * If a runtime is returned, `startupBehavior` property of the runtime
		 * metadata is respected here; use `Immediately` to start the runtime
		 * right away, or any other value to save the runtime as the project
		 * default without starting it.
		 */
		recommendedWorkspaceRuntime(): Thenable<LanguageRuntimeMetadata | undefined>;

		/**
		 * An optional event that fires when a new runtime is discovered.
		 *
		 * Not fired during `discoverRuntimes()`; used to notify Positron of a
		 * new runtime or environment after the initial discovery has completed.
		 */
		onDidDiscoverRuntime?: vscode.Event<LanguageRuntimeMetadata>;

		/**
		 * An optional metadata validation function. If provided, Positron will
		 * validate any stored metadata before attempting to use it to create a
		 * new session. This happens when a workspace is re-opened, for example.
		 *
		 * If the metadata is invalid, the function should return a new version
		 * of the metadata with the necessary corrections.
		 *
		 * If it is not possible to correct the metadata, the function should
		 * reject with an error.
		 *
		 * @param metadata The metadata to validate
		 * @returns A Thenable that resolves with an updated version of the
		 *   metadata.
		 */
		validateMetadata?(metadata: LanguageRuntimeMetadata):
			Thenable<LanguageRuntimeMetadata>;

		/**
		 * An optional session validation function. If provided, Positron will
		 * validate any stored session metadata before reconnecting to the
		 * session.
		 *
		 * @param metadata The metadata to validate
		 * @returns A Thenable that resolves with true (the session is valid) or
		 *  false (the session is invalid).
		 */
		validateSession?(sessionId: string): Thenable<boolean>;

		/**
		 * Creates a new runtime session.
		 *
		 * @param runtimeMetadata One of the runtime metadata items returned by
		 * `discoverRuntimes`.
		 * @param sessionMetadata The metadata for the new session.
		 *
		 * @returns A Thenable that resolves with the new session, or rejects with an error.
		 */
		createSession(runtimeMetadata: LanguageRuntimeMetadata,
			sessionMetadata: RuntimeSessionMetadata):
			Thenable<LanguageRuntimeSession>;

		/**
		 * Reconnects to a runtime session using the given metadata.
		 *
		 * Implementing this method is optional, since not all sessions can be
		 * reconnected; for example, sessions that run in the browser cannot be
		 * reconnected.
		 *
		 * @param runtimeMetadata The metadata for the runtime that owns the
		 * session.
		 * @param sessionMetadata The metadata for the session to reconnect.
		 *
		 * @returns A Thenable that resolves with the reconnected session, or
		 * rejects with an error.
		 */
		restoreSession?(runtimeMetadata: LanguageRuntimeMetadata,
			sessionMetadata: RuntimeSessionMetadata):
			Thenable<LanguageRuntimeSession>;
	}

	/**
	 * An enum representing the set of runtime method error codes; these map to
	 * JSON-RPC error codes.
	 */
	export enum RuntimeMethodErrorCode {
		ParseError = -32700,
		InvalidRequest = -32600,
		MethodNotFound = -32601,
		InvalidParams = -32602,
		InternalError = -32603,
		ServerErrorStart = -32000,
		ServerErrorEnd = -32099
	}

	/**
	 * An error returned by a runtime method call.
	 */
	export interface RuntimeMethodError {
		/** An error code */
		code: RuntimeMethodErrorCode;

		/** A human-readable error message */
		message: string;

		/**
		 * A name for the error, for compatibility with the Error object.
		 * Usually `RPC Error ${code}`.
		 */
		name: string;

		/** Additional error information (optional) */
		data: any | undefined;
	}

	/**
	 * Enum of available channels for a language runtime session.
	 * Used to enumerate available channels for users.
	 */
	export enum LanguageRuntimeSessionChannel {
		Console = 'console',
		Kernel = 'kernel',
		LSP = 'lsp',
	}

	/**
	 * LanguageRuntimeSession is an interface implemented by extensions that provide a
	 * set of common tools for interacting with a language runtime, such as code
	 * execution, LSP implementation, and plotting.
	 */
	export interface LanguageRuntimeSession extends vscode.Disposable {

		/** An object supplying immutable metadata about this specific session */
		readonly metadata: RuntimeSessionMetadata;

		/**
		 * An object supplying metadata about the runtime with which this
		 * session is associated.
		 */
		readonly runtimeMetadata: LanguageRuntimeMetadata;

		/** The state of the runtime that changes during a user session */
		dynState: LanguageRuntimeDynState;

		/** An object that emits language runtime events */
		onDidReceiveRuntimeMessage: vscode.Event<LanguageRuntimeMessage>;

		/** An object that emits the current state of the runtime */
		onDidChangeRuntimeState: vscode.Event<RuntimeState>;

		/** An object that emits an event when the user's session ends and the runtime exits */
		onDidEndSession: vscode.Event<LanguageRuntimeExit>;

		/**
		 * Opens a resource in the runtime.
		 * @param resource The resource to open.
		 * @returns true if the resource was opened; otherwise, false.
		 */
		openResource?(resource: vscode.Uri | string): Thenable<boolean>;

		/**
		 * Execute code in the runtime
		 *
		 * @param code The code to execute
		 * @param id The language ID of the code
		 * @param mode The code execution mode
		 * @param errorBehavior The code execution error behavior
		 * Note: The errorBehavior parameter is currently ignored by kernels
		 */
		execute(code: string,
			id: string,
			mode: RuntimeCodeExecutionMode,
			errorBehavior: RuntimeErrorBehavior): void;

		/**
		 * Calls a method in the runtime and returns the result.
		 *
		 * Throws a RuntimeMethodError if the method call fails.
		 *
		 * @param method The name of the method to call
		 * @param args Arguments to pass to the method
		 */
		callMethod?(method: string, ...args: any[]): Thenable<any>;

		/** Test a code fragment for completeness */
		isCodeFragmentComplete(code: string): Thenable<RuntimeCodeFragmentStatus>;

		/**
		 * Create a new instance of a client; return null if the client type
		 * is not supported by this runtime, or a string containing the ID of
		 * the client if it is supported.
		 *
		 * @param id The unique, client-supplied ID of the client instance. Can be any
		 *   unique string.
		 * @param type The type of client to create
		 * @param params A set of parameters to pass to the client; specific to the client type
		 * @param metadata A set of metadata to pass to the client; specific to the client type
		 */
		createClient(id: string, type: RuntimeClientType, params: any, metadata?: any): Thenable<void>;

		/**
		 * List all clients, optionally filtered by type.
		 *
		 * @param type If specified, only clients of this type will be returned.
		 * @returns A Thenable that resolves with a map of client IDs to client types.
		 */
		listClients(type?: RuntimeClientType): Thenable<Record<string, string>>;

		/** Remove an instance of a client (created with `createClient`) */
		removeClient(id: string): void;

		/**
		 * Send a message to the server end of a client instance. Any replies to the message
		 * will be sent back to the client via the `onDidReceiveRuntimeMessage` event, with
		 * the `parent_id` field set to the `message_id` given here.
		 */
		sendClientMessage(client_id: string, message_id: string, message: any): void;

		/** Reply to a prompt issued by the runtime */
		replyToPrompt(id: string, reply: string): void;

		/**
		 * Set the current working directory of the session.
		 */
		setWorkingDirectory(dir: string): Thenable<void>;

		/**
		 * Start the session; returns a Thenable that resolves with information about the runtime.
		 * If the runtime fails to start for any reason, the Thenable should reject with an error
		 * object containing a `message` field with a human-readable error message and an optional
		 * `details` field with additional information.
		 */
		start(): Thenable<LanguageRuntimeInfo>;

		/**
		 * Interrupt the runtime; returns a Thenable that resolves when the interrupt has been
		 * successfully sent to the runtime (not necessarily when it has been processed)
		 */
		interrupt(): Thenable<void>;

		/**
		 * Restart the runtime; returns a Thenable that resolves when the runtime restart sequence
		 * has been successfully started (not necessarily when it has completed). A restart will
		 * cause the runtime to be shut down and then started again; its status will change from
		 * `Restarting` => `Exited` => `Initializing` => `Starting` => `Ready`.
		 *
		 * @param workingDirectory The new working directory to use for the
		 * restarted runtime, if any. Use `undefined` to keep the current
		 * working directory.
		 */
		restart(workingDirectory?: string): Thenable<void>;

		/**
		 * Shut down the runtime; returns a Thenable that resolves when the
		 * runtime shutdown sequence has been successfully started (not
		 * necessarily when it has completed).
		 */
		shutdown(exitReason: RuntimeExitReason): Thenable<void>;

		/**
		 * Forcibly quits the runtime; returns a Thenable that resolves when the
		 * runtime has been terminated. This may be called by Positron if the
		 * runtime fails to respond to an interrupt and/or shutdown call, and
		 * should forcibly terminate any underlying processes.
		 */
		forceQuit(): Thenable<void>;

		/**
		 * Show runtime log in output panel.
		 *
		 * @param channel The channel to show the output in
		 */
		showOutput?(channel?: LanguageRuntimeSessionChannel): void;

		/**
		 * Return a list of output channels
		 *
		 * @returns A list of output channels available on this runtime
		 */
		listOutputChannels?(): LanguageRuntimeSessionChannel[];

		/**
		 * Show profiler log if supported.
		 */
		showProfile?(): Thenable<void>;
	}


	/**
	 * A data structure that describes a handler for a runtime client instance,
	 * and is called when an instance is created.
	 *
	 * @param client The client instance that was created
	 * @param params A set of parameters passed to the client
	 * @returns true if the handler took ownership of the client, false otherwise
	 */
	export type RuntimeClientHandlerCallback = (
		client: RuntimeClientInstance,
		params: Object,) => boolean;

	/**
	 * A data structure that describes a handler for a runtime client instance.
	 */
	export interface RuntimeClientHandler {
		/**
		 * The type of client that this handler handles.
		 */
		clientType: string;

		/**
		 * A callback that is called when a client of the given type is created;
		 * returns whether the handler took ownership of the client.
		 */
		callback: RuntimeClientHandlerCallback;
	}

	/**
	 * Content settings for webviews hosted in the Preview panel.
	 *
	 * This interface mirrors the `WebviewOptions` & `WebviewPanelOptions` interfaces, with
	 * the following exceptions:
	 *
	 * - `enableFindWidget` is not supported (we never show it in previews)
	 * - `retainContextWhenHidden` is not supported (we always retain context)
	 * - `enableCommandUris` is not supported (we never allow commands in previews)
	 */
	export interface PreviewOptions {
		/**
		 * Controls whether scripts are enabled in the webview content or not.
		 *
		 * Defaults to false (scripts-disabled).
		 */
		readonly enableScripts?: boolean;

		/**
		 * Controls whether forms are enabled in the webview content or not.
		 *
		 * Defaults to true if {@link PreviewOptions.enableScripts scripts are enabled}. Otherwise defaults to false.
		 * Explicitly setting this property to either true or false overrides the default.
		 */
		readonly enableForms?: boolean;

		/**
		 * Root paths from which the webview can load local (filesystem) resources using uris from `asWebviewUri`
		 *
		 * Default to the root folders of the current workspace plus the extension's install directory.
		 *
		 * Pass in an empty array to disallow access to any local resources.
		 */
		readonly localResourceRoots?: readonly vscode.Uri[];

		/**
		 * Mappings of localhost ports used inside the webview.
		 *
		 * Port mapping allow webviews to transparently define how localhost ports are resolved. This can be used
		 * to allow using a static localhost port inside the webview that is resolved to random port that a service is
		 * running on.
		 *
		 * If a webview accesses localhost content, we recommend that you specify port mappings even if
		 * the `webviewPort` and `extensionHostPort` ports are the same.
		 *
		 * *Note* that port mappings only work for `http` or `https` urls. Websocket urls (e.g. `ws://localhost:3000`)
		 * cannot be mapped to another port.
		 */
		readonly portMapping?: readonly vscode.WebviewPortMapping[];
	}

	/**
	 * A preview panel that contains a webview. This interface mirrors the
	 * `WebviewPanel` interface, but omits elements that don't apply to
	 * preview panels, such as `viewColumn`.
	 */
	export interface PreviewPanel {
		/**
		 * Identifies the type of the preview panel, such as `'markdown.preview'`.
		 */
		readonly viewType: string;

		/**
		 * Title of the panel shown in UI.
		 */
		title: string;

		/**
		 * {@linkcode Webview} belonging to the panel.
		 */
		readonly webview: vscode.Webview;

		/**
		 * Whether the panel is active (focused by the user).
		 */
		readonly active: boolean;

		/**
		 * Whether the panel is visible.
		 */
		readonly visible: boolean;

		/**
		 * Fired when the panel's view state changes.
		 */
		readonly onDidChangeViewState: vscode.Event<PreviewPanelOnDidChangeViewStateEvent>;

		/**
		 * Fired when the panel is disposed.
		 *
		 * This may be because the user closed the panel or because `.dispose()` was
		 * called on it.
		 *
		 * Trying to use the panel after it has been disposed throws an exception.
		 */
		readonly onDidDispose: vscode.Event<void>;

		/**
		 * Show the preview panel
		 *
		 * Only one preview panel can be shown at a time. If a different preview
		 * is already showing, it will be hidden.
		 *
		 * @param preserveFocus When `true`, the webview will not take focus.
		 */
		reveal(preserveFocus?: boolean): void;

		/**
		 * Dispose of the preview panel.
		 *
		 * This closes the panel if it showing and disposes of the resources
		 * owned by the underlying webview.  Preview panels are also disposed
		 * when the user closes the preview panel. Both cases fire the
		 * `onDispose` event.
		 */
		dispose(): any;
	}

	/**
	 * Event fired when a preview panel's view state changes.
	 */
	export interface PreviewPanelOnDidChangeViewStateEvent {
		/**
		 * Preview panel whose view state changed.
		 */
		readonly previewPanel: PreviewPanel;
	}

	export interface StatementRangeProvider {
		/**
		 * Given a cursor position, return the range of the statement that the
		 * cursor is within. If the cursor is not within a statement, return the
		 * range of the next statement, if one exists.
		 *
		 * @param document The document in which the command was invoked.
		 * @param position The position at which the command was invoked.
		 * @param token A cancellation token.
		 * @return The range of the statement at the given position.
		 */
		provideStatementRange(document: vscode.TextDocument,
			position: vscode.Position,
			token: vscode.CancellationToken): vscode.ProviderResult<StatementRange>;
	}

	/**
	 * The range of a statement, plus optionally the code for the range.
	 */
	export interface StatementRange {
		/**
		 * The range of the statement at the given position.
		 */
		readonly range: vscode.Range;

		/**
		 * The code for this statement range, if different from the document contents at this range.
		 */
		readonly code?: string;

	}

	export interface HelpTopicProvider {
		/**
		 * Given a cursor position, return the help topic relevant to the cursor
		 * position, or an empty string if no help topic is recommended or
		 * relevant.
		 *
		 * @param document The document in which the command was invoked.
		 * @param position The position at which the command was invoked.
		 * @param token A cancellation token.
		 * @return A string containing the help topic relevant to the cursor
		 *   position
		 */
		provideHelpTopic(document: vscode.TextDocument,
			position: vscode.Position,
			token: vscode.CancellationToken): vscode.ProviderResult<string>;
	}

	export interface Console {
		/**
		 * Pastes text into the console.
		 */
		pasteText(text: string): void;
	}

	/**
	 * ConnectionsInput interface defines the structure for connection inputs.
	 */
	export interface ConnectionsInput {
		/**
		 * The unique identifier for the input.
		 */
		id: string;
		/**
		 * A human-readable label for the input.
		 */
		label: string;
		/**
		 * The type of the input.
		 */
		type: 'string' | 'number' | 'option';
		/**
		 * Options, if the input type is an option.
		 */
		options?: { 'identifier': string; 'title': string }[];
		/**
		 * The default value for the input.
		 */
		value?: string;
	}

	/**
	 * ConnectionsDriverMetadata interface defines the structure for connection driver metadata.
	 */
	export interface ConnectionsDriverMetadata {
		/**
		 * The language identifier for the driver.
		 * Drivers are grouped by language, not by runtime.
		 */
		languageId: string;
		/**
		 * A human-readable name for the driver.
		 */
		name: string;
		/**
		 * The base64-encoded SVG icon for the driver.
		 */
		base64EncodedIconSvg?: string;
		/**
		 * The inputs required to create a connection.
		 * For instance, a connection might require a username
		 * and password.
		 */
		inputs: Array<ConnectionsInput>;
	}

	export interface ConnectionsDriver {
		/**
		 * The unique identifier for the driver.
		 */
		driverId: string;

		/**
		 * The metadata for the driver.
		 */
		metadata: ConnectionsDriverMetadata;

		/**
		 * Generates the connection code based on the inputs.
		 */
		generateCode?: (inputs: Array<ConnectionsInput>) => string;

		/**
		 * Connect session.
		 */
		connect?: (code: string) => Promise<void>;

		/**
		 * Checks if the dependencies for the driver are installed
		 * and functioning.
		 */
		checkDependencies?: () => Promise<boolean>;

		/**
		 * Installs the dependencies for the driver.
		 * For instance, R packages would install the required
		 * R packages, and or other dependencies.
		 */
		installDependencies?: () => Promise<boolean>;
	}

	namespace languages {
		/**
		 * Register a statement range provider.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A statement range provider.
		 * @return A {@link Disposable} that unregisters this provider when being disposed.
		 */
		export function registerStatementRangeProvider(
			selector: vscode.DocumentSelector,
			provider: StatementRangeProvider): vscode.Disposable;

		/**
		 * Register a help topic provider.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A help topic provider.
		 * @return A {@link Disposable} that unregisters this provider when being disposed.
		 */
		export function registerHelpTopicProvider(
			selector: vscode.DocumentSelector,
			provider: HelpTopicProvider): vscode.Disposable;
	}

	namespace window {
		/**
		 * Create and show a new preview panel.
		 *
		 * @param viewType Identifies the type of the preview panel.
		 * @param title Title of the panel.
		 * @param options Settings for the new panel.
		 *
		 * @return New preview panel.
		 */
		export function createPreviewPanel(viewType: string, title: string, preserveFocus?: boolean, options?: PreviewOptions): PreviewPanel;

		/**
		 * Create and show a new preview panel for a URL. This is a convenience
		 * method that creates a new webview panel and sets its content to the
		 * given URL.
		 *
		 * @param url The URL to preview
		 *
		 * @return New preview panel.
		 */
		export function previewUrl(url: vscode.Uri): PreviewPanel;

		/**
		 * Create and show a new preview panel for an HTML file. This is a
		 * convenience method that creates a new webview panel and sets its
		 * content to that of the given file.
		 *
		 * @param path The fully qualified path to the HTML file to preview
		 *
		 * @return New preview panel.
		 */
		export function previewHtml(path: string): PreviewPanel;

		/**
		 * Create a log output channel from raw data.
		 *
		 * Variant of `createOutputChannel()` that creates a "raw log" output channel.
		 * Compared to a normal `LogOutputChannel`, this doesn't add timestamps or info
		 * level. It's meant for extensions that create fully formed log lines but still
		 * want to benefit from the colourised rendering of log output channels.
		 *
		 * @param name Human-readable string which will be used to represent the channel in the UI.
		 *
		 * @return New log output channel.
		 */
		export function createRawLogOutputChannel(name: string): vscode.OutputChannel;

		/**
		 * Create and show a simple modal dialog prompt.
		 *
		 * @param title The title of the dialog
		 * @param message The message to display in the dialog
		 * @param okButtonTitle The title of the OK button (optional; defaults to 'OK')
		 * @param cancelButtonTitle The title of the Cancel button (optional; defaults to 'Cancel')
		 *
		 * @returns A Thenable that resolves to true if the user clicked OK, or false
		 *   if the user clicked Cancel.
		 */
		export function showSimpleModalDialogPrompt(title: string,
			message: string,
			okButtonTitle?: string,
			cancelButtonTitle?: string): Thenable<boolean>;

		/**
		 * Create and show a different simple modal dialog prompt.
		 *
		 * @param title The title of the dialog
		 * @param message The message to display in the dialog
		 * @param okButtonTitle The title of the OK button (optional; defaults to 'OK')
		 *
		 * @returns A Thenable that resolves when the user clicks OK.
		 */
		export function showSimpleModalDialogMessage(title: string,
			message: string,
			okButtonTitle?: string): Thenable<null>;

		/**
		 * Get the `Console` for a runtime language `id`
		 *
		 * @param id The runtime language `id` to retrieve a `Console` for, i.e. 'r' or 'python'.
		 *
		 * @returns A `Console`, or `undefined` if no `Console` for that language exists.
		 */
		export function getConsoleForLanguage(id: string): Console | undefined;

		/**
		 * Fires when the width of the console input changes. The new width is passed as
		 * a number, which represents the number of characters that can fit in the
		 * console horizontally.
		 */
		export const onDidChangeConsoleWidth: vscode.Event<number>;

		/**
		 * Returns the current width of the console input, in characters.
		 */
		export function getConsoleWidth(): Thenable<number>;
	}

	namespace runtime {
		/**
		 * An object that observes an ongoing code execution invoked from the
		 * `executeCode` API.
		 */
		export interface ExecutionObserver {
			/**
			 * An optional cancellation token that can be used to cancel the
			 * execution.
			 */
			token?: vscode.CancellationToken;

			/**
			 * An optional callback to invoke when execution has started. This
			 * may be different than the time `executeCode` was called, since
			 * there may have been preceding statements in the queue, or we may
			 * need to wait for the runtime to start or become ready.
			 */
			onStarted?: () => void;

			/**
			 * An optional callback to invoke when the execution emits text
			 * output. This can be called zero or more times during execution of
			 * the code.
			 *
			 * @param message The message emitted.
			 */
			onOutput?: (message: string) => void;

			/**
			 * An optional callback to invoke when the execution emits error
			 * output. This just means "output sent to standard error", and does
			 * not mean that the execution failed. This can be called zero or more
			 * times during execution of the code.
			 *
			 * @param message The message emitted.
			 */
			onError?: (message: string) => void;

			/**
			 * An optional callback to invoke when the execution emits a plot.
			 *
			 * NOTE: Currently only fired for static plots, not dynamic plots.
			 *
			 * @param plotData The plot data emitted, as a string.
			 */
			onPlot?: (plotData: string) => void;

			/**
			 * An optional callback to invoke when the execution emits a data
			 * frame or other rectangular data object.
			 *
			 * NOTE: Not currently fired.
			 *
			 * @param data The data returned.
			 */
			onData?: (data: any) => void;

			/**
			 * An optional callback to invoke when the execution has completed
			 * sucessfully.
			 *
			 * One of `onCompleted` or `onFailed` will be called, but not both.
			 *
			 * @param result The result of the successful execution, as a map of MIME types to values.
			 */
			onCompleted?: (result: Record<string, any>) => void;

			/**
			 * An optional callback to invoke when the execution has failed.
			 *
			 * One of `onCompleted` or `onFailed` will be called, but not both.
			 *
			 * @param error The error that caused the execution to fail.
			 */
			onFailed?: (error: Error) => void;

			/**
			 * An optional callback to invoke when the execution has finished,
			 * regardless of success or failure.
			 *
			 * It is invoked when the runtime returns to an idle state after
			 * fully completing the execution.
			 */
			onFinished?: () => void;
		}

		/**
		 * Executes code in a language runtime's console, as though it were typed
		 * interactively by the user.
		 *
		 * @param languageId The language ID of the code snippet
		 * @param code The code snippet to execute
		 * @param focus Whether to focus the runtime's console
		 * @param allowIncomplete Whether to bypass runtime code completeness checks. If true, the `code`
		 *   will be executed by the runtime even if it is incomplete or invalid. Defaults to false
		 * @param mode Possible code execution mode for a language runtime
		 * @param errorBehavior Possible error behavior for a language runtime, currently ignored by kernels
		 * @param observer An optional observer for the execution. This object will be notified of
		 *  execution events, such as output, error, and completion.
		 * @returns A Thenable that resolves with the result of the code execution,
		 *  as a map of MIME types to values.
		 */
		export function executeCode(languageId: string,
			code: string,
			focus: boolean,
			allowIncomplete?: boolean,
			mode?: RuntimeCodeExecutionMode,
			errorBehavior?: RuntimeErrorBehavior,
			observer?: ExecutionObserver): Thenable<Record<string, any>>;

		/**
		 * Register a language runtime manager with Positron.
		 *
		 * @param languageId The language ID for which the runtime
		 * @returns A disposable that unregisters the manager when disposed.
		 *
		 */
		export function registerLanguageRuntimeManager(languageId: string, manager: LanguageRuntimeManager): vscode.Disposable;

		/**
		 * List all registered runtimes.
		 */
		export function getRegisteredRuntimes(): Thenable<LanguageRuntimeMetadata[]>;

		/**
		 * Get the preferred language runtime for a given language.
		 *
		 * @param languageId The language ID of the preferred runtime
		 */
		export function getPreferredRuntime(languageId: string): Thenable<LanguageRuntimeMetadata>;

		/**
		 * List all active sessions.
		 */
		export function getActiveSessions(): Thenable<LanguageRuntimeSession[]>;

		/**
		 * Get the active foreground session, if any.
		 */
		export function getForegroundSession(): Thenable<LanguageRuntimeSession | undefined>;

		/**
		 * Get the session corresponding to a notebook, if any.
		 *
		 * @param notebookUri The URI of the notebook.
		 */
		export function getNotebookSession(notebookUri: vscode.Uri): Thenable<LanguageRuntimeSession | undefined>;

		/**
		 * Select and start a runtime previously registered with Positron. Any
		 * previously active runtimes for the language will be shut down.
		 *
		 * @param runtimeId The ID of the runtime to select and start.
		 */
		export function selectLanguageRuntime(runtimeId: string): Thenable<void>;

		/**
		 * Start a new session for a runtime previously registered with Positron.
		 *
		 * @param runtimeId The ID of the runtime to select and start.
		 * @param sessionName A human-readable name for the new session.
		 * @param notebookUri If the session is associated with a notebook,
		 *   the notebook URI.
		 *
		 * Returns a Thenable that resolves with the newly created session.
		 */
		export function startLanguageRuntime(runtimeId: string,
			sessionName: string,
			notebookUri?: vscode.Uri): Thenable<LanguageRuntimeSession>;

		/**
		 * Restart a running session.
		 *
		 * @param sessionId The ID of the session to restart.
		 */
		export function restartSession(sessionId: string): Thenable<void>;

		/**
		 * Register a handler for runtime client instances. This handler will be called
		 * whenever a new client instance is created by a language runtime of the given
		 * type.
		 *
		 * @param handler A handler for runtime client instances
		 */
		export function registerClientHandler(handler: RuntimeClientHandler): vscode.Disposable;

		/**
		 * Register a runtime client instance. Registering the instance
		 * indicates that the caller has ownership of the instance, and that
		 * messages the instance receives do not need to be forwarded to the
		 * Positron core.
		 */
		export function registerClientInstance(clientInstanceId: string): vscode.Disposable;

		/**
		 * An event that fires when a new runtime is registered.
		 */
		export const onDidRegisterRuntime: vscode.Event<LanguageRuntimeMetadata>;

		/**
		 * An event that fires when the foreground session changes
		 */
		export const onDidChangeForegroundSession: vscode.Event<string | undefined>;
	}

	// FIXME: The current (and clearly not final) state of an experiment to bring in interface(s)
	// here by referring to an external file. Such an external file will presumably be generated by
	// the generate-comms.ts script. Two goals of the experiment:
	// * Reduce the manual proliferation of these generated types.
	// * Ideally a file is meant to edited by humans or by robots, but not both.
	// Related to https://github.com/posit-dev/positron/issues/12
	type EC = import('./ui-comm.js').EditorContext;
	export type EditorContext = EC;

	/**
	 * This namespace contains all frontend RPC methods available to a runtime.
	 */
	namespace methods {
		/**
		 * Call a frontend method.
		 *
		 * `call()` is designed to be hooked up directly to an RPC mechanism. It takes
		 * `method` and `params` arguments as defined by the UI frontend OpenRPC contract
		 * and returns a JSON-RPC response. It never throws, all errors are returned as
		 * JSON-RPC error responses.
		 *
		 * @param method The method name.
		 * @param params An object of named parameters for `method`.
		 */
		export function call(method: string, params: Record<string, any>): Thenable<any>;

		/**
		 * Retrieve last active editor context.
		 *
		 * Returns a `EditorContext` for the last active editor.
		 */
		export function lastActiveEditorContext(): Thenable<EditorContext | null>;

		/**
		 * Create and show a simple modal dialog prompt.
		 *
		 * @param title The title of the dialog
		 * @param message The message to display in the dialog
		 * @param okButtonTitle The title of the OK button
		 * @param cancelButtonTitle The title of the Cancel button
		 *
		 * @returns A Thenable that resolves to true if the user clicked OK, or false
		 *   if the user clicked Cancel.
		 */
		export function showQuestion(title: string, message: string, okButtonTitle: string, cancelButtonTitle: string): Thenable<boolean>;

		/**
		 * Create and show a different simple modal dialog prompt.
		 *
		 * @param title The title of the dialog
		 * @param message The message to display in the dialog
		 *
		 * @returns A Thenable that resolves when the user dismisses the dialog.
		 */
		export function showDialog(title: string, message: string): Thenable<null>;


	}

	/**
	 * Refers to methods related to the connections pane
	 */
	namespace connections {
		/**
		 * Registers a new connection driver with Positron allowing extensions to contribute
		 * to the 'New Connection' dialog.
		 *
		 * @param driver The connection driver to register
		 * @returns A disposable that unregisters the driver when disposed
		 */
		export function registerConnectionDriver(driver: ConnectionsDriver): vscode.Disposable;
	}

	/**
	 * Experimental AI features.
	 */
	namespace ai {
		/**
		 * A language model provider, extends vscode.LanguageModelChatProvider.
		 */
		export interface LanguageModelChatProvider {
			name: string;
			provider: string;
			identifier: string;

			/**
			 * Handle a language model request with tool calls and streaming chat responses.
			 */
			provideLanguageModelResponse(
				messages: vscode.LanguageModelChatMessage[],
				options: vscode.LanguageModelChatRequestOptions,
				extensionId: string,
				progress: vscode.Progress<{
					index: number;
					part: vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart;
				}>,
				token: vscode.CancellationToken,
			): Thenable<any>;

			/**
			 * Calculate the token count for a given string.
			 */
			provideTokenCount(text: string | vscode.LanguageModelChatMessage, token: vscode.CancellationToken): Thenable<number>;

			/**
			 * Tests the connection to the language model provider.
			 *
			 * Returns an error if the connection fails.
			 */
			resolveConnection(token: vscode.CancellationToken): Thenable<Error | undefined>;
		}

		/**
		 * Dynamically defined chat agent properties and metadata.
		 */
		export interface ChatAgentData {
			id: string;
			name: string;
			fullName?: string;
			description?: string;
			isDefault?: boolean;
			metadata: { isSticky?: boolean };
			slashCommands: {
				name: string;
				description: string;
				isSticky?: boolean;
			}[];
			locations: PositronChatAgentLocation[];
			disambiguation: { category: string; description: string; examples: string[] }[];
		}

		/**
		 * A chat participant, extends vscode.ChatParticipant with additional dynamic metadata.
		 */
		export interface ChatParticipant extends vscode.ChatParticipant {
			agentData: ChatAgentData;
		}

		/**
		 * Register a chat agent dynamically, without requiring registration in `package.json`.
		 * This allows for dynamic chat agent commands in Positron.
		 */
		export function registerChatAgent(agentData: ChatAgentData): Thenable<vscode.Disposable>;

		/**
		 * Positron Language Model source, used for user configuration of language models.
		 */
		export interface LanguageModelSource {
			type: PositronLanguageModelType;
			provider: { id: string; displayName: string };
			supportedOptions: Exclude<{
				[K in keyof LanguageModelConfig]: undefined extends LanguageModelConfig[K] ? K : never
			}[keyof LanguageModelConfig], undefined>[];
			defaults: LanguageModelConfigOptions;
			signedIn?: boolean;
		}

		/**
		 * Positron Language Model configuration.
		 */
		export interface LanguageModelConfig extends LanguageModelConfigOptions {
			type: PositronLanguageModelType;
			provider: string;
		}

		/**
		 * Positron Language Model configuration options.
		 */
		export interface LanguageModelConfigOptions {
			name: string;
			model: string;
			baseUrl?: string;
			apiKey?: string;
			toolCalls?: boolean;
			resourceName?: string;
			project?: string;
			location?: string;
			numCtx?: number;
		}

		/**
		 * Request the current plot data.
		 */
		export function getCurrentPlotUri(): Thenable<string | undefined>;

		/**
		 * Get Positron global context information to be included with every request.
		 */
		export function getPositronChatContext(request: vscode.ChatRequest): Thenable<ChatContext>;

		/**
		 * Send a progress response to the chat response stream.
		 */
		export function responseProgress(token: unknown, part: vscode.ChatResponsePart | {
			// vscode.ChatResponseConfirmationPart
			title: string;
			message: string;
			data: any;
			buttons?: string[];
		} | {
			// vscode.ChatResponseTextEditPart
			uri: vscode.Uri;
			edits: vscode.TextEdit[];
		}): void;

		export function getSupportedProviders(): Thenable<string[]>;

		/**
		 * Show a modal dialog for language model configuration.
		 */
		export function showLanguageModelConfig(
			sources: LanguageModelSource[],
			onAction: (config: LanguageModelConfig, action: string) => Thenable<void>,
		): Thenable<void>;

		/**
		 * Adds the model to the service's known configurations and notifies its listeners.
		 * @param id the model id
		 * @param config the model config
		 */
		export function addLanguageModelConfig(
			source: LanguageModelSource,
		): void;

		/**
		 * Removes the model from the service's known configurations and notifies its listeners.
		 * @param id the model id
		 */
		export function removeLanguageModelConfig(
			source: LanguageModelSource,
		): void;

		/**
		 * The context in which a chat request is made.
		 */
		export interface ChatContext {
			console?: {
				language: string;
				version: string;
			};
			variables?: {
				name: string;
				value: string;
				type: string;
			}[];
			shell?: string;
		}
	}
}
