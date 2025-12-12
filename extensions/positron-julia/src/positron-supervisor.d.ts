/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
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
	 */
	kernel_protocol_version: string; // eslint-disable-line

	/** Optional preflight command to run before starting the kernel */
	startup_command?: string;

	/** Function that starts the kernel given a JupyterSession object. */
	startKernel?: (session: JupyterSession, kernel: JupyterKernel) => Promise<void>;
}

/**
 * A language runtime that wraps a Jupyter kernel.
 */
export interface JupyterLanguageRuntimeSession extends positron.LanguageRuntimeSession {
	startPositronLsp(clientId: string, ipAddress: string): Promise<number>;
	createPositronLspClientId(): string;
	createComm(target_name: string, params?: Record<string, unknown>): Promise<Comm>;
	createServerComm(targetName: string, ip_address: string): Promise<[Comm, number]>;
	createDapComm(targetName: string, debugType: string, debugName: string): Promise<DapComm>;
	emitJupyterLog(message: string, logLevel?: vscode.LogLevel): void;
	showOutput(channel?: positron.LanguageRuntimeSessionChannel): void;
	listOutputChannels(): positron.LanguageRuntimeSessionChannel[];
	callMethod(method: string, ...args: Array<any>): Promise<any>;
	getKernelLogFile(): string;
}

/**
 * The Positron Supervisor API as exposed by the Positron Supervisor extension.
 */
export interface PositronSupervisorApi extends vscode.Disposable {
	createSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata,
		kernel: JupyterKernelSpec,
		dynState: positron.LanguageRuntimeDynState,
		extra?: JupyterKernelExtra | undefined,
	): Promise<JupyterLanguageRuntimeSession>;

	validateSession(sessionId: string): Promise<boolean>;

	restoreSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata,
		dynState: positron.LanguageRuntimeDynState,
	): Promise<JupyterLanguageRuntimeSession>;
}

export interface JupyterKernelExtra {
	attachOnStartup?: {
		init: (args: Array<string>) => void;
		attach: () => Promise<void>;
	};
	sleepOnStartup?: {
		init: (args: Array<string>, delay: number) => void;
	};
}

export interface Comm {
	id: string;
	receiver: ReceiverChannel<CommBackendMessage>;
	notify: (method: string, params?: Record<string, unknown>) => void;
	request: (method: string, params?: Record<string, unknown>) => Promise<any>;
	dispose: () => Promise<void>;
}

export interface ReceiverChannel<T> extends AsyncIterable<T>, vscode.Disposable {
	next(): Promise<IteratorResult<T>>;
}

export interface CommError extends Error {
	readonly name: 'CommError' | 'CommClosedError' | 'CommRpcError';
	readonly method?: string;
}

export interface CommClosedError extends CommError {
	readonly name: 'CommClosedError';
}

export interface CommRpcError extends CommError {
	readonly name: 'CommRpcError';
	readonly code: number;
}

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

export interface DapComm {
	readonly targetName: string;
	readonly debugType: string;
	readonly debugName: string;
	readonly comm?: Comm;
	readonly serverPort?: number;
	handleMessage(msg: any): Promise<boolean>;
	dispose(): void;
}
