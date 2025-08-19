/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';

export interface JupyterSessionState {
	/** The Jupyter session identifier; sent as part of every message */
	sessionId: string;

	/** The log file the kernel is writing to */
	logFile: string;

	/** The profile file the kernel is writing to */
	profileFile?: string;

	/** The connection file specifying the ZeroMQ ports, signing keys, etc. */
	connectionFile: string;

	/** The ID of the kernel's process, or 0 if the process is not running */
	processId: number;
}

export interface JupyterSession {
	readonly state: JupyterSessionState;
}

export interface JupyterKernel {
	connectToSession(session: JupyterSession): Promise<void>;
	log(msg: string): void;
}

/**
 * Message sent from the frontend requesting a server to start
 */
export interface ServerStartMessage {
	/** The IP address or host name on which the client is listening for server requests. The server is
	 * in charge of picking the exact port to communicate over, since the server is the
	 * one that binds to the port (to prevent race conditions).
	 */
	host: string;
}

/**
 * Message sent to the frontend to acknowledge that the corresponding server has started
 */
export interface ServerStartedMessage {
	/** The port that the frontend should connect to on the `ip_address` it sent over */
	port: number;
}

/**
 * This set of type definitions defines the interfaces used by the Positron
 * Supervisor extension.
 */

/**
 * Represents a registered Jupyter Kernel. These types are defined in the
 * Jupyter documentation at:
 *
 * https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs
 */
export interface JupyterKernelSpec {
	/** Command used to start the kernel and an array of command line arguments */
	argv: Array<string>;

	/** The kernel's display name */
	display_name: string;  // eslint-disable-line

	/** The language the kernel executes */
	language: string;

	/** Interrupt mode (signal or message) */
	interrupt_mode?: 'signal' | 'message'; // eslint-disable-line

	/** Environment variables to set when starting the kernel */
	env?: NodeJS.ProcessEnv;

	/**
	 * The Jupyter protocol version to use when connecting to the kernel.
	 *
	 * When protocol >= 5.5 is used, the supervisor will use a handshake
	 * to negotiate ports instead of picking them ahead of time (JEP 66)
	 */
	kernel_protocol_version: string; // eslint-disable-line

	/** Function that starts the kernel given a JupyterSession object.
	 *  This is used to start the kernel if it's provided. In this case `argv`
	 *  is ignored.
	*/
	startKernel?: (session: JupyterSession, kernel: JupyterKernel) => Promise<void>;
}

/**
 * A language runtime that wraps a Jupyter kernel.
 */
export interface JupyterLanguageRuntimeSession extends positron.LanguageRuntimeSession {
	/**
	 * Convenience method for starting the Positron LSP server, if the
	 * language runtime supports it.
	 *
	 * @param clientId The ID of the client comm, created with
	 *  `createPositronLspClientId()`.
	 * @param ipAddress The address of the client that will connect to the
	 *  language server.
	 */
	startPositronLsp(clientId: string, ipAddress: string): Promise<number>;

	/**
	 * Convenience method for creating a client id to pass to
	 * `startPositronLsp()`. The caller can later remove the client using this
	 * id as well.
	 */
	createPositronLspClientId(): string;

	/**
	 * Creates a server communication channel and returns both the comm and the port.
	 *
	 * @param targetName The name of the comm target
	 * @param host The IP address or host name for the server
	 * @returns A promise that resolves to a tuple of [RawComm, port number]
	 */
	createServerComm(targetName: string, host: string): Promise<[RawComm, number]>;

	/**
	 * Start a raw comm for communication between frontend and backend.
	 *
	 * Unlike Positron clients, this kind of comm is private to the calling
	 * extension and its kernel.
	 *
	 * @param target_name Comm type, also used to generate comm identifier.
	 * @param params Optionally, additional parameters included in `comm_open`.
	 */
	createComm(
		target_name: string,
		params?: Record<string, unknown>,
	): Promise<RawComm>;

	/**
	 * Method for emitting a message to the language server's Jupyter output
	 * channel.
	 *
	 * @param message A message to emit to the Jupyter log.
	 * @param logLevel Optionally, the log level of the message.
	 */
	emitJupyterLog(message: string, logLevel?: vscode.LogLevel): void;

	/**
	 * A Jupyter kernel is guaranteed to have a `showOutput()`
	 * method, so we declare it non-optional.
	 *
	 * @param channel The name of the output channel to show.
	 * If not provided, the default channel is shown.
	 */
	showOutput(channel?: positron.LanguageRuntimeSessionChannel): void;

	/**
	 * Return a list of output channels
	 *
	 * @returns A list of output channels available on this runtime
	 */
	listOutputChannels(): positron.LanguageRuntimeSessionChannel[];

	/**
	 * A Jupyter kernel is guaranteed to have a `callMethod()` method; it uses
	 * the frontend comm to send a message to the kernel and wait for a
	 * response.
	 */
	callMethod(method: string, ...args: Array<any>): Promise<any>;

	/**
	 * Return logfile path
	 */
	getKernelLogFile(): string;
}

/**
 * The Positron Supervisor API as exposed by the Positron Supervisor extension.
 */
export interface PositronSupervisorApi extends vscode.Disposable {

	/**
	 * Create a session for a Jupyter-compatible kernel.
	 *
	 * @param runtimeMetadata The metadata for the language runtime to be
	 * wrapped by the adapter.
	 * @param sessionMetadata The metadata for the session to be created.
	 * @param kernel A Jupyter kernel spec containing the information needed to
	 *   start the kernel.
	 * @param dynState The initial dynamic state of the session.
	 * @param extra Optional implementations for extra functionality.
	 *
	 * @returns A JupyterLanguageRuntimeSession that wraps the kernel.
	 */
	createSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata,
		kernel: JupyterKernelSpec,
		dynState: positron.LanguageRuntimeDynState,
		extra?: JupyterKernelExtra | undefined,
	): Promise<JupyterLanguageRuntimeSession>;

	/**
	 * Validate an existing session for a Jupyter-compatible kernel.
	 */
	validateSession(sessionId: string): Promise<boolean>;

	/**
	 * Restore a session for a Jupyter-compatible kernel.
	 *
	 * @param runtimeMetadata The metadata for the language runtime to be
	 * wrapped by the adapter.
	 * @param sessionMetadata The metadata for the session to be reconnected.
	 * @param dynState The initial dynamic state of the session.
	 *
	 * @returns A JupyterLanguageRuntimeSession that wraps the kernel.
	 */
	restoreSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata,
		dynState: positron.LanguageRuntimeDynState,
	): Promise<JupyterLanguageRuntimeSession>;

	/**
	 * The DAP comm class.
	 *
	 * Wraps a raw server comm (see `createServerComm()`) and provides an optional
	 * `handleMessage()` method for the standard DAP messages.
	 *
	 * Must be disposed. Disposing closes the comm if not already done.
	 */
	readonly DapComm: typeof DapComm;
}

/** Specific functionality implemented by runtimes */
export interface JupyterKernelExtra {
	attachOnStartup?: {
		init: (args: Array<string>) => void;
		attach: () => Promise<void>;
	};
	sleepOnStartup?: {
		init: (args: Array<string>, delay: number) => void;
	};
}

/**
 * Raw comm unmanaged by Positron.
 *
 * This type of comm is not mapped to a Positron client. It lives entirely in
 * the extension space and allows a direct line of communication between an
 * extension and its kernel.
 *
 * It's a disposable. Dispose of it once it's closed or you're no longer using
 * it. If the comm has not already been closed by the kernel, a client-initiated
 * `comm_close` message is emitted to clean the comm on the backend side.
 */
export interface RawComm {
	/** The comm ID. */
	id: string;

	/** Async-iterable for messages sent from backend. */
	receiver: Channel<CommBackendMessage>;

	/** Send a notification to the backend comm. Returns `false` if comm was closed. */
	notify: (method: string, params?: Record<string, unknown>) => boolean;

	/**
	 * Make a request to the backend comm.
	 *
	 * Resolves when backend responds with a length-2 tuple:
	 * - A boolean that indicates whether the comm was closed and the request
	 *   could not be emitted.
	 * - The result if the request was performed.
	 */
	request: (method: string, params?: Record<string, unknown>) => Promise<[boolean, any]>;

	/** Clear resources and sends `comm_close` to backend comm (unless the channel
		* was closed by the backend already). */
	dispose: () => void;
}

/**
 * Async-iterable receiver channel for comm messages from the backend.
 * The messages are buffered and must be received as long as the channel is open.
 * Dispose to close.
 */
export interface Channel<T> extends AsyncIterable<T>, vscode.Disposable { }

/**
 * Message from the backend.
 *
 * If a request, the `handle` method _must_ be called.
 * Throw an error from `handle` to reject the request (e.g. if `method` is unknown).
 */
export type CommBackendMessage =
	| {
		kind: 'request';
		method: string;
		params?: Record<string, unknown>;
		handle: (handler: () => any) => void;
	}
	| {
		kind: 'notification';
		method: string;
		params?: Record<string, unknown>;
	};

/**
 * A Debug Adapter Protocol (DAP) comm.
 *
 * This wraps a raw comm that:
 *
 * - Implements the server protocol (see `createComm()` and
 *   `JupyterLanguageRuntimeSession::createServerComm()`).
 *
 * - Optionally handles a standard set of DAP comm messages.
 */
export class DapComm {
	/**
	 * Constructs a new DapComm instance.
	 *
	 * @param session The Jupyter language runtime session.
	 * @param targetName The name of the comm target.
	 * @param debugType The type of debugger, as required by `vscode.DebugConfiguration.type`.
	 * @param debugName The name of the debugger, as required by `vscode.DebugConfiguration.name`.
	 */
	constructor(
		session: JupyterLanguageRuntimeSession,
		targetName: string,
		debugType: string,
		debugName: string,
	);

	/** The `targetName` passed to the constructor. */
	readonly targetName: string;

	/** The `debugType` passed to the constructor. */
	readonly debugType: string;

	/** The `debugName` passed to the constructor. */
	readonly debugName: string;

	/**
	 * The raw comm for the DAP.
	 * Use it to receive messages or make notifications and requests.
	 * Defined after `createServerComm()` has been called.
	 */
	readonly comm?: RawComm;

	/**
	 * The port on which the DAP server is listening.
	 * Defined after `createServerComm()` has been called.
	 */
	readonly serverPort?: number;

	/**
	 * Crate the raw server comm.
	 *
	 * Calls `JupyterLanguageRuntimeSession::createServerComm()`. The backend
	 * comm handling for `targetName` is expected to start a DAP server and
	 * communicate the port as part of the handshake.
	 *
	 * Once resolved:
	 * - The DAP is ready to accept connections on the backend side.
	 * - `comm` and `serverPort` are defined.
	 */
	createComm(): Promise<void>;

	/**
	 * Handle a message received via `this.comm.receiver`.
	 *
	 * This is optional. If called, these message types are handled:
	 *
	 * - `start_debug`: A debugging session is started from the frontend side,
	 *   connecting to `this.serverPort`.
	 *
	 * - `execute`: A command is visibly executed in the console. Can be used to
	 *   handle DAP requests like "step" via the console, delegating to the
	 *   interpreter's own debugging infrastructure.
	 *
	 * - `restart`: The console session is restarted. Can be used to handle a
	 *   restart DAP request on the backend side.
	 *
	 * Returns whether the message was handled. Note that if the message was not
	 * handled, you _must_ check whether the message is a request, and either
	 * handle or reject it in that case.
	 */
	handleMessage(msg: any): boolean;

	/**
	 * Dispose of the underlying comm.
	 * Must be called if the DAP comm is no longer in use.
	 * Closes the comm if not done already.
	 */
	dispose(): void;
}
