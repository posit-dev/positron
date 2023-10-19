/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
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

		/** A message representing a new comm (client instance) being opened from the rutime side */
		CommOpen = 'comm_open',

		/** A message representing data received via a comm (to a client instance) */
		CommData = 'comm_data',

		/** A message indicating that a comm (client instance) was closed from the server side */
		CommClosed = 'comm_closed',
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

		/** The runtime's host process has ended. */
		Exited = 'exited',

		/** The runtime is not responding to heartbeats and is presumed offline. */
		Offline = 'offline',
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
	}

	export interface LanguageRuntimeEventData { }

	/** LanguageRuntimeOutput is a LanguageRuntimeMessage representing output (text, plots, etc.) */
	export interface LanguageRuntimeOutput extends LanguageRuntimeMessage {
		/** A record of data MIME types to the associated data, e.g. `text/plain` => `'hello world'` */
		data: Record<string, string>;
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

		/** FIXME
		 * These are for compatibility until runtimes have added
		 * support for the config struct */
		inputPrompt?: string;
		continuationPrompt?: string;
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
	}

	/**
	 * The set of client types that can be generated by a language runtime. Note
	 * that, because client types can share a namespace with other kinds of
	 * widgets, each client type in Positron's API is prefixed with the string
	 * "positron".
	 */
	export enum RuntimeClientType {
		Environment = 'positron.environment',
		Lsp = 'positron.lsp',
		Dap = 'positron.dap',
		Plot = 'positron.plot',
		DataViewer = 'positron.dataViewer',
		FrontEnd = 'positron.frontEnd',
		Help = 'positron.help',

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
	 * An instance of a client widget generated by a language runtime. See
	 * RuntimeClientType for the set of possible client types.
	 *
	 * The client is responsible for disposing itself when it is no longer
	 * needed; this will trigger the closure of the communications channel
	 * between the client and the runtime.
	 */
	export interface RuntimeClientInstance extends vscode.Disposable {
		onDidChangeClientState: vscode.Event<RuntimeClientState>;
		onDidSendEvent: vscode.Event<object>;
		performRpc<T>(data: object): Thenable<T>;
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

	export type LanguageRuntimeProvider = AsyncGenerator<LanguageRuntime>;

	/**
	 * LanguageRuntime is an interface implemented by extensions that provide a
	 * set of common tools for interacting with a language runtime, such as code
	 * execution, LSP implementation, and plotting.
	 */
	export interface LanguageRuntime extends vscode.Disposable {
		/** An object supplying metadata about the runtime */
		readonly metadata: LanguageRuntimeMetadata;

		/** The state of the runtime that changes during a user session */
		dynState: LanguageRuntimeDynState;

		/** An object that emits language runtime events */
		onDidReceiveRuntimeMessage: vscode.Event<LanguageRuntimeMessage>;

		/** An object that emits the current state of the runtime */
		onDidChangeRuntimeState: vscode.Event<RuntimeState>;

		/** An object that emits an event when the user's session ends and the runtime exits */
		onDidEndSession: vscode.Event<LanguageRuntimeExit>;

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
		 *
		 * @param id The unique, client-supplied ID of the client instance. Can be any
		 *   unique string.
		 * @param type The type of client to create
		 * @param params A set of parameters to pass to the client; specific to the client type
		 */
		createClient(id: string, type: RuntimeClientType, params: any): Thenable<void>;

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
		 * Start the runtime; returns a Thenable that resolves with information about the runtime.
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
		 */
		restart(): Thenable<void>;

		/**
		 * Shut down the runtime; returns a Thenable that resolves when the
		 * runtime shutdown sequence has been successfully started (not
		 * necessarily when it has completed).
		 */
		shutdown(): Thenable<void>;

		/**
		 * Forcibly quits the runtime; returns a Thenable that resolves when the
		 * runtime has been terminated. This may be called by Positron if the
		 * runtime fails to respond to an interrupt and/or shutdown call, and
		 * should forcibly terminate any underlying processes.
		 */
		forceQuit(): Thenable<void>;

		/**
		 * Show runtime log in output panel.
		 */
		showOutput?(): void;

		/**
		 * Create a new instance of the runtime.
		 *
		 * NOTE: This is a temporary workaround to get notebooks working with our
		 *       runtimes, until we implement runtime sessions. "Cloned" runtimes
		 *       will not be known by the language runtime service thus cannot
		 *       integrate with any of our existing functionality. This method
		 *       should not be used outside of our notebook extension.
		 *
		 * @param metadata The metadata for the new runtime instance.
		 * @param notebook The notebook that this runtime belongs to.
		 * @returns A new runtime instance.
		 */
		clone(metadata: LanguageRuntimeMetadata, notebook: vscode.NotebookDocument): LanguageRuntime;
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
		 * A callback that is called when a client of the given type is created.
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
	interface PreviewPanel {
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
			token: vscode.CancellationToken): vscode.ProviderResult<vscode.Range>;
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
	}

	namespace runtime {

		/**
		 * Executes code in a language runtime's console, as though it were typed
		 * interactively by the user.
		 *
		 * @param languageId The language ID of the code snippet
		 * @param code The code snippet to execute
		 * @param focus Whether to raise and focus the runtime's console
		 * @returns A Thenable that resolves with true if the code was sent to a
		 *   runtime successfully, false otherwise.
		 */
		export function executeCode(languageId: string,
			code: string,
			focus: boolean): Thenable<boolean>;

		/**
		 * Register a language runtime provider with Positron.
		 *
		 * @param languageId The language ID for which runtimes will be supplied
		 * @param provider A function that returns an AsyncIterable of runtime registrations
		 */
		export function registerLanguageRuntimeProvider(languageId: string,
			provider: LanguageRuntimeProvider): void;

		/**
		 * Register a single language runtime with Positron.
		 *
		 * @param runtime The language runtime to register
		 */
		export function registerLanguageRuntime(runtime: LanguageRuntime): vscode.Disposable;

		/**
		 * List all registered runtimes.
		 */
		export function getRegisteredRuntimes(): Thenable<LanguageRuntime[]>;

		/**
		 * Get the preferred language runtime for a given language.
		 *
		 * @param languageId The language ID of the preferred runtime
		 */
		export function getPreferredRuntime(languageId: string): Thenable<LanguageRuntime>;

		/**
		 * List the running runtimes for a given language.
		 *
		 * @param languageId The language ID for running runtimes
		 */
		export function getRunningRuntimes(languageId: string): Thenable<LanguageRuntimeMetadata[]>;

		/**
		 * Select and start a runtime previously registered with Positron. Any
		 * previously active runtimes for the language will be shut down.
		 *
		 * @param runtimeId The ID of the runtime to select and start.
		 */
		export function selectLanguageRuntime(runtimeId: string): Thenable<void>;

		/**
		 * Restart a running runtime.
		 *
		 * @param runtimeId The ID of the running runtime to restart.
		 */
		export function restartLanguageRuntime(runtimeId: string): Thenable<void>;

		/**
		 * Register a handler for runtime client instances. This handler will be called
		 * whenever a new client instance is created by a language runtime of the given
		 * type.
		 *
		 * @param handler A handler for runtime client instances
		 */
		export function registerClientHandler(handler: RuntimeClientHandler): vscode.Disposable;

		/**
		 * An event that fires when a new runtime is registered.
		 */
		export const onDidRegisterRuntime: vscode.Event<LanguageRuntime>;
	}
}
