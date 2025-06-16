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
 * the extension space and allows private communication between an extension and
 * its kernel.
 *
 * It's a disposable. Dispose of it once it's closed or you're no longer using
 * it. If the comm has not already been closed by the kernel, a client-initiated
 * `comm_close` message is emitted.
 */
export interface RawComm {
	/** The comm ID. */
	id: string;

	/** Async-iterable for messages sent from backend. */
	receiver: Channel<CommBackendMessage>;

	/** Send a notification to the backend comm. Returns `false` if comm was closed. */
	notify: (method: string, params?: Record<string, unknown>) => boolean;

	/** Make a request to the backend comm. Resolves when backend responds. The tuple's
			* first value indicates whether the comm was closed (and no request was emitted).
			* The second value is the result if the request was made. */
	request: (method: string, params?: Record<string, unknown>) => Promise<[boolean, any]>;

	/** Clear resources and sends `comm_close` to backend comm (unless the channel
			* was closed by the backend already). */
	dispose: () => void;
}

/**
 * Communication channel. Dispose to close.
 */
export interface Channel<T> extends AsyncIterable<T>, vscode.Disposable { }

/** Message from the backend.
 *
 * If a request, the `handle` method _must_ be called.
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
