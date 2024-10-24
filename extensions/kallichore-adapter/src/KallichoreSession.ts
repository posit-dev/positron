/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { JupyterKernelExtra, JupyterKernelSpec, JupyterLanguageRuntimeSession } from './jupyter-adapter';
import { ActiveSession, DefaultApi, HttpError, InterruptMode, NewSession, StartupError, Status } from './kcclient/api';
import { JupyterMessage } from './jupyter/JupyterMessage';
import { JupyterRequest } from './jupyter/JupyterRequest';
import { KernelInfoRequest } from './jupyter/KernelInfoRequest';
import { Barrier, PromiseHandles, withTimeout } from './async';
import { ExecuteRequest, JupyterExecuteRequest } from './jupyter/ExecuteRequest';
import { IsCompleteRequest, JupyterIsCompleteRequest } from './jupyter/IsCompleteRequest';
import { CommInfoRequest } from './jupyter/CommInfoRequest';
import { JupyterCommOpen } from './jupyter/JupyterCommOpen';
import { CommOpenCommand } from './jupyter/CommOpenCommand';
import { JupyterCommand } from './jupyter/JupyterCommand';
import { CommCloseCommand } from './jupyter/CommCloseCommand';
import { JupyterCommMsg } from './jupyter/JupyterCommMsg';
import { RuntimeMessageEmitter } from './RuntimeMessageEmitter';
import { CommMsgCommand } from './jupyter/CommMsgCommand';
import { ShutdownRequest } from './jupyter/ShutdownRequest';
import { LogStreamer } from './LogStreamer';
import { JupyterMessageHeader } from './jupyter/JupyterMessageHeader';
import { JupyterChannel } from './jupyter/JupyterChannel';
import { InputReplyCommand } from './jupyter/InputReplyCommand';
import { RpcReplyCommand } from './jupyter/RpcReplyCommand';
import { JupyterCommRequest } from './jupyter/JupyterCommRequest';
import { Comm } from './Comm';
import { CommMsgRequest } from './jupyter/CommMsgRequest';
import { DapClient } from './DapClient';
import { SocketSession } from './ws/SocketSession';
import { KernelOutputMessage } from './ws/KernelMessage';

export class KallichoreSession implements JupyterLanguageRuntimeSession {
	/**
	 * The runtime messages emitter; consumes Jupyter messages and translates
	 * them to Positron language runtime messages
	 */
	private readonly _messages: RuntimeMessageEmitter = new RuntimeMessageEmitter();

	/** Emitter for runtime state changes */
	private readonly _state: vscode.EventEmitter<positron.RuntimeState>;

	/** Emitter for runtime exit events */
	private readonly _exit: vscode.EventEmitter<positron.LanguageRuntimeExit>;

	/** Emitter for disconnection events  */
	readonly disconnected: vscode.EventEmitter<positron.RuntimeState>;

	/** Barrier: opens when the session has been established on Kallichore */
	private readonly _established: Barrier = new Barrier();

	/** Barrier: opens when the WebSocket is connected and Jupyter messages can
	 * be sent and received */
	private _connected: Barrier = new Barrier();

	/** Barrier: opens when the kernel has started up and has a heartbeat */
	private _ready: Barrier = new Barrier();

	/** Cached exit reason; used to indicate an exit is expected so we can
	 * distinguish between expected and unexpected exits */
	private _exitReason: positron.RuntimeExitReason = positron.RuntimeExitReason.Unknown;

	/** The WebSocket connection to the Kallichore server for this session
	 */
	private _socket: SocketSession | undefined;

	/** The current runtime state of this session */
	private _runtimeState: positron.RuntimeState = positron.RuntimeState.Uninitialized;

	/** A map of pending RPCs, used to pair up requests and replies */
	private _pendingRequests: Map<string, JupyterRequest<any, any>> = new Map();

	/** Objects that should be disposed when the session is disposed */
	private _disposables: vscode.Disposable[] = [];

	/** Whether we are currently restarting the kernel */
	private _restarting = false;

	/** The Debug Adapter Protocol client, if any */
	private _dapClient: DapClient | undefined;

	/** A map of pending comm startups */
	private _startingComms: Map<string, PromiseHandles<void>> = new Map();

	/**
	 * The channel to which output for this specific kernel is logged, if any
	 */
	private readonly _kernelChannel: vscode.OutputChannel;

	/**
	 * The channel to which output for this specific console is logged
	 */
	private readonly _consoleChannel: vscode.LogOutputChannel;

	/**
	 * The channel to which profile output for this specific kernel is logged, if any
	 */
	private _profileChannel: vscode.OutputChannel | undefined;

	/** A map of active comm channels */
	private readonly _comms: Map<string, Comm> = new Map();

	/** The kernel's log file, if any. */
	private _kernelLogFile: string | undefined;

	/**
	 * The active session on the Kallichore server. Currently, this is only
	 * defined for sessions that have been restored after reload or navigation.
	 */
	private _activeSession: ActiveSession | undefined;

	/**
	 * The message header for the current requests if any is active.  This is
	 * used for input requests (e.g. from `readline()` in R) Concurrent requests
	 * are not supported.
	 */
	private _activeBackendRequestHeader: JupyterMessageHeader | null = null;

	constructor(readonly metadata: positron.RuntimeSessionMetadata,
		readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
		readonly dynState: positron.LanguageRuntimeDynState,
		private readonly _api: DefaultApi,
		private _new: boolean,
		private readonly _extra?: JupyterKernelExtra | undefined) {

		// Create event emitters
		this._state = new vscode.EventEmitter<positron.RuntimeState>();
		this._exit = new vscode.EventEmitter<positron.LanguageRuntimeExit>();
		this.disconnected = new vscode.EventEmitter<positron.RuntimeState>();

		// Ensure the emitters are disposed when the session is disposed
		this._disposables.push(this._state);
		this._disposables.push(this._exit);
		this._disposables.push(this.disconnected);

		this.onDidReceiveRuntimeMessage = this._messages.event;

		this.onDidChangeRuntimeState = this._state.event;

		this.onDidEndSession = this._exit.event;

		// Establish log channels for the console and kernel we're connecting to
		this._consoleChannel = vscode.window.createOutputChannel(
			metadata.notebookUri ?
				`${runtimeMetadata.runtimeName}: Notebook: (${path.basename(metadata.notebookUri.path)})` :
				`${runtimeMetadata.runtimeName}: Console`,
			{ log: true });

		this._kernelChannel = positron.window.createRawLogOutputChannel(
			`${runtimeMetadata.runtimeName}: Kernel`);
	}

	/**
	 * Create the session in on the Kallichore server.
	 *
	 * @param kernelSpec The Jupyter kernel spec to use for the session
	 */
	public async create(kernelSpec: JupyterKernelSpec) {
		if (!this._new) {
			throw new Error(`Session ${this.metadata.sessionId} already exists`);
		}

		// Forward the environment variables from the kernel spec
		const env = {};
		if (kernelSpec.env) {
			Object.assign(env, kernelSpec.env);
		}

		// Prepare the working directory; use the workspace root if available,
		// otherwise the home directory
		let workingDir = vscode.workspace.workspaceFolders?.[0].uri.fsPath || os.homedir();

		// If we have a notebook URI, use its parent directory as the working
		// directory instead. Note that not all notebooks have valid on-disk
		// URIs since they may be transient or not yet saved; for these, we fall
		// back to the workspace root or home directory.
		if (this.metadata.notebookUri?.fsPath) {
			const notebookPath = this.metadata.notebookUri.fsPath;
			if (fs.existsSync(notebookPath)) {
				workingDir = path.dirname(notebookPath);
			}
		}

		// Form the command-line arguments to the kernel process
		const tempdir = os.tmpdir();
		const sep = path.sep;
		const kerneldir = fs.mkdtempSync(`${tempdir}${sep}kernel-`);
		const logFile = path.join(kerneldir, 'kernel.log');
		const profileFile = path.join(kerneldir, 'kernel-profile.log');
		const args = kernelSpec.argv.map((arg, _idx) => {

			// Replace {log_file} with the log file path. Not all kernels
			// have this argument.
			if (arg === '{log_file}') {
				fs.writeFile(logFile, '', () => {
					this.streamLogFile(logFile);
				});
				return logFile;
			}

			// Same as `log_file` but for profiling logs
			if (profileFile && arg === '{profile_file}') {
				fs.writeFile(profileFile, '', () => {
					this.streamProfileFile(profileFile);
				});
				return profileFile;
			}

			return arg;
		}) as Array<string>;

		// Default to message-based interrupts
		let interruptMode = InterruptMode.Message;

		// If the kernel spec specifies an interrupt mode, use it
		if (kernelSpec.interrupt_mode) {
			switch (kernelSpec.interrupt_mode) {
				case 'signal':
					interruptMode = InterruptMode.Signal;
					break;
				case 'message':
					interruptMode = InterruptMode.Message;
					break;
			}
		}

		// Initialize extra functionality, if any. These settings modify the
		// argument list `args` in place, so need to happen right before we send
		// the arg list to the server.
		const config = vscode.workspace.getConfiguration('kallichoreSupervisor');
		const attachOnStartup = config.get('attachOnStartup', false) && this._extra?.attachOnStartup;
		const sleepOnStartup = config.get('sleepOnStartup', undefined) && this._extra?.sleepOnStartup;
		if (attachOnStartup) {
			this._extra!.attachOnStartup!.init(args);
		}
		if (sleepOnStartup) {
			const delay = config.get('sleepOnStartup', 0);
			this._extra!.sleepOnStartup!.init(args, delay);
		}

		// Create the session in the underlying API
		const session: NewSession = {
			argv: args,
			sessionId: this.metadata.sessionId,
			language: kernelSpec.language,
			displayName: this.metadata.sessionName,
			inputPrompt: '',
			continuationPrompt: '',
			env,
			workingDirectory: workingDir,
			username: os.userInfo().username,
			interruptMode
		};
		await this._api.newSession(session);
		this.log(`Session created: ${JSON.stringify(session)}`, vscode.LogLevel.Info);
		this._established.open();
	}

	/**
	 * Requests that the kernel start a Language Server Protocol server, and
	 * connect it to the client with the given TCP address.
	 *
	 * Note: This is only useful if the kernel hasn't already started an LSP
	 * server.
	 *
	 * @param clientAddress The client's TCP address, e.g. '127.0.0.1:1234'
	 */
	async startPositronLsp(clientAddress: string) {
		// Create a unique client ID for this instance
		const clientId = `positron-lsp-${this.runtimeMetadata.languageId}-${this.createUniqueId()}`;
		this.log(`Starting LSP server ${clientId} for ${clientAddress}`, vscode.LogLevel.Info);

		// Notify Positron that we're handling messages from this client
		this._disposables.push(positron.runtime.registerClientInstance(clientId));

		// Ask the backend to create the client
		await this.createClient(
			clientId,
			positron.RuntimeClientType.Lsp,
			{ client_address: clientAddress }
		);

		// Create a promise that will resolve when the LSP starts on the server
		// side.
		const startPromise = new PromiseHandles<void>();
		this._startingComms.set(clientId, startPromise);
		return startPromise.promise;
	}

	/**
	 * Requests that the kernel start a Debug Adapter Protocol server, and
	 * connect it to the client locally on the given TCP port.
	 *
	 * @param serverPort The port on which to bind locally.
	 * @param debugType Passed as `vscode.DebugConfiguration.type`.
	 * @param debugName Passed as `vscode.DebugConfiguration.name`.
	 */
	async startPositronDap(
		serverPort: number,
		debugType: string,
		debugName: string,
	) {
		// NOTE: Ideally we'd connect to any address but the
		// `debugServer` property passed in the configuration below
		// needs to be a port for localhost.
		const serverAddress = `127.0.0.1:${serverPort}`;

		// TODO: Should we query the kernel to see if it can create a DAP
		// (QueryInterface style) instead of just demanding it?
		//
		// The Jupyter kernel spec does not provide a way to query for
		// supported comms; the only way to know is to try to create one.

		// Create a unique client ID for this instance
		const clientId = `positron-dap-${this.runtimeMetadata.languageId}-${this.createUniqueId()}`;
		this.log(`Starting DAP server ${clientId} for ${serverAddress}`, vscode.LogLevel.Debug);

		// Notify Positron that we're handling messages from this client
		this._disposables.push(positron.runtime.registerClientInstance(clientId));

		await this.createClient(
			clientId,
			positron.RuntimeClientType.Dap,
			{ client_address: serverAddress }
		);

		// Create the DAP client message handler
		this._dapClient = new DapClient(clientId, serverPort, debugType, debugName, this);
	}

	/**
	 * Forwards a message to the Jupyter log output channel.
	 *
	 * @param message The message to log
	 * @param logLevel The log level of the message
	 */
	emitJupyterLog(message: string, logLevel?: vscode.LogLevel): void {
		this.log(message, logLevel);
	}

	/**
	 * Reveals the output channel for this kernel.
	 */
	showOutput(): void {
		this._kernelChannel?.show();
	}

	/**
	 * Calls a method on the UI comm for this kernel.
	 *
	 * @param method The method's name
	 * @param args Additional arguments to pass to the method
	 * @returns The result of the method call
	 */
	callMethod(method: string, ...args: Array<any>): Promise<any> {
		const promise = new PromiseHandles;

		// Find the UI comm
		const uiComm = Array.from(this._comms.values())
			.find(c => c.target === positron.RuntimeClientType.Ui);
		if (!uiComm) {
			throw new Error(`Cannot invoke '${method}'; no UI comm is open.`);
		}

		// Create the request. This uses a JSON-RPC 2.0 format, with an
		// additional `msg_type` field to indicate that this is a request type
		// for the UI comm.
		//
		// NOTE: Currently using nested RPC messages for convenience but
		// we'd like to do better
		const request = {
			jsonrpc: '2.0',
			method: 'call_method',
			params: {
				method,
				params: args
			},
		};

		const commMsg: JupyterCommMsg = {
			comm_id: uiComm.id,
			data: request
		};

		const commRequest = new CommMsgRequest(this.createUniqueId(), commMsg);
		this.sendRequest(commRequest).then((reply) => {
			const response = reply.data;

			// If the response is an error, throw it
			if (Object.keys(response).includes('error')) {
				const error = response.error;

				// Populate the error object with the name of the error code
				// for conformity with code that expects an Error object.
				error.name = `RPC Error ${response.error.code}`;

				promise.reject(error);
			}

			// JSON-RPC specifies that the return value must have either a 'result'
			// or an 'error'; make sure we got a result before we pass it back.
			if (!Object.keys(response).includes('result')) {
				const error: positron.RuntimeMethodError = {
					code: positron.RuntimeMethodErrorCode.InternalError,
					message: `Invalid response from UI comm: no 'result' field. ` +
						`(response = ${JSON.stringify(response)})`,
					name: `InvalidResponseError`,
					data: {},
				};

				promise.reject(error);
			}

			// Otherwise, return the result
			promise.resolve(response.result);
		})
			.catch((err) => {
				this.log(`Failed to send UI comm request: ${JSON.stringify(err)}`, vscode.LogLevel.Error);
				promise.reject(err);
			});

		return promise.promise;
	}

	/**
	 * Gets the path to the kernel's log file, if any.
	 *
	 * @returns The kernel's log file.
	 * @throws An error if the log file is not available.
	 */
	getKernelLogFile(): string {
		if (!this._kernelLogFile) {
			throw new Error('Kernel log file not available');
		}
		return this._kernelLogFile;
	}

	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>;

	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>;

	onDidEndSession: vscode.Event<positron.LanguageRuntimeExit>;

	/**
	 * Requests that the kernel execute a code fragment.
	 *
	 * @param code The code to execute
	 * @param id An ID for the code fragment; used to identify output and errors
	 * that come from this code fragment.
	 * @param mode The execution mode
	 * @param errorBehavior What to do if an error occurs
	 */
	execute(code: string,
		id: string,
		mode: positron.RuntimeCodeExecutionMode,
		errorBehavior: positron.RuntimeErrorBehavior): void {

		// Translate the parameters into a Jupyter execute request
		const request: JupyterExecuteRequest = {
			code,
			silent: mode === positron.RuntimeCodeExecutionMode.Silent,
			store_history: mode === positron.RuntimeCodeExecutionMode.Interactive,
			user_expressions: new Map(),
			allow_stdin: true,
			stop_on_error: errorBehavior === positron.RuntimeErrorBehavior.Stop,
		};

		// Create and send the execute request
		const execute = new ExecuteRequest(id, request);
		this.sendRequest(execute).then((reply) => {
			this.log(`Execution result: ${JSON.stringify(reply)}`, vscode.LogLevel.Debug);
		}).catch((err) => {
			// This should be exceedingly rare; it represents a failure to send
			// the request to Kallichore rather than a failure to execute it
			this.log(`Failed to send execution request for '${code}': ${err}`, vscode.LogLevel.Error);
		});
	}

	/**
	 * Tests whether a code fragment is complete.
	 * @param code The code to test
	 * @returns The status of the code fragment
	 */
	async isCodeFragmentComplete(code: string): Promise<positron.RuntimeCodeFragmentStatus> {
		// Form the Jupyter request
		const request: JupyterIsCompleteRequest = {
			code
		};
		const isComplete = new IsCompleteRequest(request);
		const reply = await this.sendRequest(isComplete);
		switch (reply.status) {
			case 'complete':
				return positron.RuntimeCodeFragmentStatus.Complete;
			case 'incomplete':
				return positron.RuntimeCodeFragmentStatus.Incomplete;
			case 'invalid':
				return positron.RuntimeCodeFragmentStatus.Invalid;
			case 'unknown':
				return positron.RuntimeCodeFragmentStatus.Unknown;
		}
	}

	/**
	 * Create a new client comm.
	 *
	 * @param id The ID of the client comm; must be unique among all comms
	 * connected to this kernel
	 * @param type The type of client comm to create
	 * @param params The parameters to pass to the client comm
	 * @param metadata Additional metadata to pass to the client comm
	 */
	async createClient(
		id: string,
		type: positron.RuntimeClientType,
		params: any,
		metadata?: any): Promise<void> {

		// Ensure the type of client we're being asked to create is a known type that supports
		// client-initiated creation
		if (type === positron.RuntimeClientType.Variables ||
			type === positron.RuntimeClientType.Lsp ||
			type === positron.RuntimeClientType.Dap ||
			type === positron.RuntimeClientType.Ui ||
			type === positron.RuntimeClientType.Help ||
			type === positron.RuntimeClientType.IPyWidgetControl) {

			const msg: JupyterCommOpen = {
				target_name: type,  // eslint-disable-line
				comm_id: id,  // eslint-disable-line
				data: params
			};
			const commOpen = new CommOpenCommand(msg, metadata);
			await this.sendCommand(commOpen);
			this._comms.set(id, new Comm(id, type));
		} else {
			this.log(`Can't create ${type} client for ${this.runtimeMetadata.languageName} (not supported)`, vscode.LogLevel.Error);
		}
	}

	/**
	 * Get a list of open clients (comms) from the kernel.
	 *
	 * @param type The type of client to list, or undefined to list all clients
	 * @returns A map of client IDs to client names (targets)
	 */
	async listClients(type?: positron.RuntimeClientType): Promise<Record<string, string>> {
		const request = new CommInfoRequest(type || '');
		const reply = await this.sendRequest(request);
		const result: Record<string, string> = {};
		const comms = reply.comms;
		// Unwrap the comm info and add it to the result
		for (const key in comms) {
			if (comms.hasOwnProperty(key)) {
				const target = comms[key].target_name;
				result[key] = target;
				// If we don't have a comm object for this comm, create one
				if (!this._comms.has(key)) {
					this._comms.set(key, new Comm(key, target));
				}
			}
		}
		return result;
	}

	removeClient(id: string): void {
		const commOpen = new CommCloseCommand(id);
		this.sendCommand(commOpen);
	}

	/**
	 * Sends a message to an open comm.
	 *
	 * @param client_id The ID of the client comm to send the message to
	 * @param message_id The ID of the message to send; used to help match
	 * replies
	 * @param message The message to send
	 */
	sendClientMessage(client_id: string, message_id: string, message: any): void {
		const msg: JupyterCommMsg = {
			comm_id: client_id,
			data: message
		};
		const commMsg = new CommMsgCommand(message_id, msg);
		this.sendCommand(commMsg).then(() => {
			// Nothing to do here; the message was sent successfully
		}).catch((err) => {
			this.log(`Failed to send message ${JSON.stringify(message)} to ${client_id}: ${err}`, vscode.LogLevel.Error);
		});
	}

	/**
	 * Sends a reply to an input prompt to the kernel.
	 *
	 * @param id The ID of the input request to reply to
	 * @param value The value to send as a reply
	 */
	replyToPrompt(id: string, value: string): void {
		if (!this._activeBackendRequestHeader) {
			this.log(`Failed to find parent for input request ${id}; sending anyway: ${value}`, vscode.LogLevel.Warning);
			return;
		}
		const reply = new InputReplyCommand(this._activeBackendRequestHeader, value);
		this.log(`Sending input reply for ${id}: ${value}`, vscode.LogLevel.Debug);
		this.sendCommand(reply);
	}

	/**
	 * Restores an existing session from the server.
	 *
	 * @param session The session to restore
	 */
	async restore(session: ActiveSession) {
		// Re-establish the log stream by looking for the `--log` or `--logfile`
		// arguments.
		//
		// CONSIDER: This is a convention used by the R and Python kernels but
		// may not be reliable for other kernels. We could handle it more
		// generically by storing this information in the session metadata.
		for (const arg of ['--log', '--logfile']) {
			const logFileIndex = session.argv.indexOf(arg);
			if (logFileIndex > 0 && logFileIndex < session.argv.length - 1) {
				const logFile = session.argv[logFileIndex + 1];
				if (fs.existsSync(logFile)) {
					this.streamLogFile(logFile);
					break;
				}
			}
		}

		// Do the same for the profile file
		const profileFileIndex = session.argv.indexOf('--profile');
		if (profileFileIndex > 0 && profileFileIndex < session.argv.length - 1) {
			const profileFile = session.argv[profileFileIndex + 1];
			if (fs.existsSync(profileFile)) {
				this.streamProfileFile(profileFile);
			}
		}

		// Open the established barrier so that we can start sending messages
		this._activeSession = session;
		this._established.open();
	}

	/**
	 * Starts a previously established session.
	 *
	 * This method is used both to start a new session and to reconnect to an
	 * existing session.
	 *
	 * @returns The kernel info for the session.
	 */
	async start(): Promise<positron.LanguageRuntimeInfo> {
		try {
			// Attempt to start the session
			await this.tryStart();
		} catch (err) {
			if (err instanceof HttpError && err.statusCode === 500) {
				// When the server returns a 500 error, it means the startup
				// failed. In this case the API returns a structured startup
				// error we can use to report the problem with more detail.
				const startupErr = err.body;
				let message = startupErr.error.message;
				if (startupErr.output) {
					message += `\n${startupErr.output}`;
				}
				const event: positron.LanguageRuntimeExit = {
					runtime_name: this.runtimeMetadata.runtimeName,
					exit_code: startupErr.exit_code ?? 0,
					reason: positron.RuntimeExitReason.StartupFailed,
					message
				};
				this._exit.fire(event);
			} else {
				// This indicates that startup failed due to a problem on the
				// client side. We still need to report an exit so that the UI
				// treats the runtime as exited.

				// Attempt to extract a message from the error, or just
				// stringify it if it's not an Error
				const message =
					err instanceof Error ? err.message : JSON.stringify(err);
				const event: positron.LanguageRuntimeExit = {
					runtime_name: this.runtimeMetadata.runtimeName,
					exit_code: 0,
					reason: positron.RuntimeExitReason.StartupFailed,
					message
				};
				this._exit.fire(event);
			}

			this.onStateChange(positron.RuntimeState.Exited);
			throw err;
		}

		return this.getKernelInfo();
	}

	/**
	 * Attempts to start the session; returns a promise that resolves when the
	 * session is ready to use.
	 */
	private async tryStart(): Promise<void> {
		// Wait for the session to be established before connecting. This
		// ensures either that we've created the session (if it's new) or that
		// we've restored it (if it's not new).
		await withTimeout(this._established.wait(), 2000, `Start failed: timed out waiting for session ${this.metadata.sessionId} to be established`);

		// If it's a new session, wait for it to be created before connecting
		if (this._new) {
			await this._api.startSession(this.metadata.sessionId);
		}

		// Before connecting, check if we should attach to the session on
		// startup
		const config = vscode.workspace.getConfiguration('kallichoreSupervisor');
		const attachOnStartup = config.get('attachOnStartup', false) && this._extra?.attachOnStartup;
		if (attachOnStartup) {
			try {
				await this._extra!.attachOnStartup!.attach();
			} catch (err) {
				this.log(`Can't execute attach action: ${err}`, vscode.LogLevel.Error);
			}
		}

		// Connect to the session's websocket
		await withTimeout(this.connect(), 2000, `Start failed: timed out connecting to session ${this.metadata.sessionId}`);

		if (this._new) {
			// If this is a new session, wait for it to be ready before
			// returning. This can take some time as it needs to wait for the
			// kernel to start up.
			await withTimeout(this._ready.wait(), 10000, `Start failed: timed out waiting for session ${this.metadata.sessionId} to be ready`);
		} else {
			if (this._activeSession?.status === Status.Busy) {
				// If the session is busy, wait for it to become idle before
				// connecting. This could take some time, so show a progress
				// notification.
				//
				// CONSIDER: This could be a long wait; it would be better
				// (though it'd require more orchestration) to bring the user
				// back to the same experience they had before the reconnecting
				// (i.e. all UI is usable but the busy indicator is shown).
				vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: vscode.l10n.t('{0} is busy; waiting for it to become idle before reconnecting.', this.metadata.sessionName),
					cancellable: false,
				}, async () => {
					await this.waitForIdle();
				});
			} else {
				// Enter the ready state immediately if the session is not busy
				this._ready.open();
				this._state.fire(positron.RuntimeState.Ready);
			}
		}
	}

	/**
	 * Waits for the session to become idle before connecting.
	 *
	 * @returns A promise that resolves when the session is idle. Does not time
	 * out or reject.
	 */
	async waitForIdle(): Promise<void> {
		this.log(`Session ${this.metadata.sessionId} is busy; waiting for it to become idle before connecting.`, vscode.LogLevel.Info);
		return new Promise((resolve, _reject) => {
			this._state.event(async (state) => {
				if (state === positron.RuntimeState.Idle) {
					resolve();
					this._ready.open();
					this._state.fire(positron.RuntimeState.Ready);
				}
			});
		});
	}

	/**
	 * Connects or reconnects to the session's websocket.
	 *
	 * @returns A promise that resolves when the websocket is connected.
	 */
	connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			// Ensure websocket is closed if it's open
			if (this._socket) {
				this._socket.close();
			}

			// Connect to the session's websocket. The websocket URL is based on
			// the base path of the API.
			const uri = vscode.Uri.parse(this._api.basePath);
			const wsUri = `ws://${uri.authority}/sessions/${this.metadata.sessionId}/channels`;
			this.log(`Connecting to websocket: ${wsUri}`, vscode.LogLevel.Debug);
			this._socket = new SocketSession(wsUri, this.metadata.sessionId);
			this._disposables.push(this._socket);

			// Handle websocket events
			this._socket.ws.onopen = () => {
				this.log(`Connected to websocket ${wsUri}.`, vscode.LogLevel.Debug);
				// Open the connected barrier so that we can start sending messages
				this._connected.open();
				resolve();
			};

			this._socket.ws.onerror = (err: any) => {
				this.log(`Websocket error: ${err}`, vscode.LogLevel.Error);
				if (this._connected.isOpen()) {
					// If the error happened after the connection was established,
					// something bad happened. Close the connected barrier and
					// show an error.
					this._connected = new Barrier();
					vscode.window.showErrorMessage(`Error connecting to ${this.metadata.sessionName} (${this.metadata.sessionId}): ${JSON.stringify(err)}`);
				} else {
					// The connection never established; reject the promise and
					// let the caller handle it.
					reject(err);
				}
			};

			this._socket.ws.onclose = (evt: any) => {
				this.log(`Websocket closed with kernel in status ${this._runtimeState}: ${JSON.stringify(evt)}`, vscode.LogLevel.Info);
				this.disconnected.fire(this._runtimeState);
				// When the socket is closed, reset the connected barrier and
				// clear the websocket instance.
				this._connected = new Barrier();
				this._socket = undefined;
			};

			// Main handler for incoming messages
			this._socket.ws.onmessage = (msg: any) => {
				this.log(`RECV message: ${msg.data}`, vscode.LogLevel.Trace);
				try {
					const data = JSON.parse(msg.data.toString());
					this.handleMessage(data);
				} catch (err) {
					this.log(`Could not parse message: ${err}`, vscode.LogLevel.Error);
				}
			};
		});
	}

	/**
	 * Interrupt a running kernel.
	 *
	 * @returns A promise that resolves when the kernel interrupt request has
	 * been sent. Note that the kernel may not be interrupted immediately.
	 */
	async interrupt(): Promise<void> {
		// Clear current input request if any
		this._activeBackendRequestHeader = null;

		try {
			await this._api.interruptSession(this.metadata.sessionId);
		} catch (err) {
			if (err instanceof HttpError) {
				throw new Error(err.body.message);
			} else {
				throw err;
			}
		}
	}

	/**
	 * Performs a restart of the kernel. Kallichore handles the mechanics of
	 * stopping the process and starting a new one; we just need to listen for
	 * the events and update our state.
	 */
	async restart(): Promise<void> {
		// Remember that we're restarting so that when the exit event arrives,
		// we can label it as such
		this._exitReason = positron.RuntimeExitReason.Restart;

		// Perform the restart
		this._restarting = true;
		try {
			await this._api.restartSession(this.metadata.sessionId);
		} catch (err) {
			if (err instanceof HttpError) {
				throw new Error(err.body.message);
			} else {
				throw err;
			}
		}
	}

	/**
	 * Performs a shutdown of the kernel.
	 *
	 * @param exitReason The reason for the shutdown
	 */
	async shutdown(exitReason: positron.RuntimeExitReason): Promise<void> {
		this._exitReason = exitReason;
		const restarting = exitReason === positron.RuntimeExitReason.Restart;
		const shutdownRequest = new ShutdownRequest(restarting);
		await this.sendRequest(shutdownRequest);
	}

	/**
	 * Forces the kernel to quit immediately.
	 */
	async forceQuit(): Promise<void> {
		try {
			this._exitReason = positron.RuntimeExitReason.ForcedQuit;
			await this._api.killSession(this.metadata.sessionId);
		} catch (err) {
			this._exitReason = positron.RuntimeExitReason.Unknown;
			if (err instanceof HttpError) {
				throw new Error(err.body.message);
			} else {
				throw err;
			}
		}
	}

	/**
	 * Shows the profile output for this kernel, if any.
	 */
	async showProfile?(): Promise<void> {
		this._profileChannel?.show();
	}

	/**
	 * Clean up the session.
	 */
	dispose() {
		// Close the log streamer, the websocket, and any other disposables
		this._disposables.forEach(d => d.dispose());
		this._disposables = [];
	}

	/**
	 * Main entry point for handling messages delivered over the websocket from
	 * the Kallichore server.
	 *
	 * @param data The message payload
	 */
	handleMessage(data: any) {
		if (!data.kind) {
			this.log(`Kallichore session ${this.metadata.sessionId} message has no kind: ${data}`, vscode.LogLevel.Warning);
			return;
		}
		switch (data.kind) {
			case 'kernel':
				this.handleKernelMessage(data);
				break;
			case 'jupyter':
				this.handleJupyterMessage(data);
				break;
		}
	}

	/**
	 * Handles kernel-level messages sent from the Kallichore server.
	 *
	 * @param data The message payload
	 */
	handleKernelMessage(data: any) {
		if (data.hasOwnProperty('status')) {
			// Check to see if the status is a valid runtime state
			if (Object.values(positron.RuntimeState).includes(data.status)) {
				this.onStateChange(data.status);
			} else {
				this.log(`Unknown state: ${data.status}`);
			}
		} else if (data.hasOwnProperty('output')) {
			const output = data as KernelOutputMessage;
			this._kernelChannel.append(output.output[1]);
		} else if (data.hasOwnProperty('exited')) {
			this.onExited(data.exited);
		}
	}

	/**
	 * Gets the current runtime state of the kernel.
	 */
	get runtimeState(): positron.RuntimeState {
		return this._runtimeState;
	}

	private onStateChange(newState: positron.RuntimeState) {
		// If the kernel is ready, open the ready barrier
		if (newState === positron.RuntimeState.Ready) {
			this.log(`Received initial heartbeat; kernel is ready.`);
			this._ready.open();
		}
		this.log(`State: ${this._runtimeState} => ${newState}`, vscode.LogLevel.Debug);
		if (newState === positron.RuntimeState.Offline) {
			// Close the connected barrier if the kernel is offline
			this._connected = new Barrier();
		}
		if (this._runtimeState === positron.RuntimeState.Offline &&
			newState !== positron.RuntimeState.Exited &&
			newState === positron.RuntimeState.Offline) {
			// The kernel was offline but is back online; open the connected
			// barrier
			this.log(`The kernel is back online.`, vscode.LogLevel.Info);
			this._connected.open();
		}
		if (newState === positron.RuntimeState.Starting) {
			this.log(`The kernel has started up after a restart.`, vscode.LogLevel.Info);
			this._restarting = false;
		}
		this._runtimeState = newState;
		this._state.fire(newState);
	}

	/**
	 * Marks the kernel as exited.
	 *
	 * @param exitCode The exit code
	 * @param reason The reason for the exit
	 */
	markExited(exitCode: number, reason: positron.RuntimeExitReason) {
		this._exitReason = reason;
		this.onStateChange(positron.RuntimeState.Exited);
		this.onExited(exitCode);
	}

	private onExited(exitCode: number) {
		if (this._restarting) {
			// If we're restarting, wait for the kernel to start up again
			this.log(`Kernel exited with code ${exitCode}; waiting for restart to finish.`, vscode.LogLevel.Info);
		} else {
			// If we aren't going to be starting up again, clean up the session
			// websocket
			this.log(`Kernel exited with code ${exitCode}; cleaning up.`, vscode.LogLevel.Info);
			this._socket?.close();
			this._socket = undefined;
			this._connected = new Barrier();
		}

		// We're no longer ready
		this._ready = new Barrier();

		// If we don't know the exit reason and there's a nonzero exit code,
		// consider this exit to be due to an error.
		if (this._exitReason === positron.RuntimeExitReason.Unknown && exitCode !== 0) {
			this._exitReason = positron.RuntimeExitReason.Error;
		}

		// Create and fire the exit event.
		const event: positron.LanguageRuntimeExit = {
			runtime_name: this.runtimeMetadata.runtimeName,
			exit_code: exitCode,
			reason: this._exitReason,
			message: ''
		};
		this._exit.fire(event);

		// We have now consumed the exit reason; restore it to its default
		this._exitReason = positron.RuntimeExitReason.Unknown;
	}

	/**
	 * Gets the kernel's information, using the `kernel_info` request.
	 *
	 * @returns The kernel's information
	 */
	async getKernelInfo(): Promise<positron.LanguageRuntimeInfo> {
		// Send the info request to the kernel; note that this waits for the
		// kernel to be connected.
		const request = new KernelInfoRequest();
		const reply = await this.sendRequest(request);

		// Translate the kernel info to a runtime info object
		const info: positron.LanguageRuntimeInfo = {
			banner: reply.banner,
			implementation_version: reply.implementation_version,
			language_version: reply.language_info.version,
		};
		return info;
	}

	/**
	 * Main entry point for handling Jupyter messages delivered over the
	 * websocket from the Kallichore server.
	 *
	 * @param data The message payload
	 */
	handleJupyterMessage(data: any) {
		// Deserialize the message buffers from base64, if any
		if (data.buffers) {
			data.buffers = data.buffers.map((b: string) => {
				return Buffer.from(b, 'base64');
			});
		}

		// Cast the data to a Jupyter message
		const msg = data as JupyterMessage;

		// Check to see if the message is a reply to a request; if it is,
		// resolve the associated promise and remove it from the pending
		// requests map
		if (msg.parent_header && msg.parent_header.msg_id) {
			const request = this._pendingRequests.get(msg.parent_header.msg_id);
			if (request) {
				if (request.replyType === msg.header.msg_type) {
					request.resolve(msg.content);
					this._pendingRequests.delete(msg.parent_header.msg_id);
				}
			}
		}

		// Special handling for stdin messages, which have reversed control flow
		if (msg.channel === JupyterChannel.Stdin) {
			switch (msg.header.msg_type) {
				// If this is an input request, save the header so we can can
				// line it up with the client's response.
				case 'input_request':
					this._activeBackendRequestHeader = msg.header;
					break;
				case 'rpc_request': {
					this.onCommRequest(msg).then(() => {
						this.log(`Handled comm request: ${JSON.stringify(msg.content)}`, vscode.LogLevel.Debug);
					})
						.catch((err) => {
							this.log(`Failed to handle comm request: ${JSON.stringify(err)}`, vscode.LogLevel.Error);
						});
					break;
				}
			}
		}

		if (msg.header.msg_type === 'comm_msg') {
			const commMsg = msg.content as JupyterCommMsg;

			// If we have a DAP client active and this is a comm message intended
			// for that client, forward the message.
			if (this._dapClient) {
				const comm = this._comms.get(commMsg.comm_id);
				if (comm && comm.id === this._dapClient.clientId) {
					this._dapClient.handleDapMessage(commMsg.data);
				}
			}

			// If this is a `server_started` message, resolve the promise that
			// was created when the comm was started.
			if (commMsg.data.msg_type === 'server_started') {
				const startingPromise = this._startingComms.get(commMsg.comm_id);
				if (startingPromise) {
					startingPromise.resolve();
					this._startingComms.delete(commMsg.comm_id);
				}
			}
		}

		// Translate the Jupyter message to a LanguageRuntimeMessage and emit it
		this._messages.emitJupyter(msg);
	}

	/**
	 * Part of a reverse request from the UI comm. These requests are fulfilled
	 * by Positron and the results sent back to the kernel.
	 *
	 * @param msg The message payload
	 */
	async onCommRequest(msg: JupyterMessage): Promise<void> {
		const request = msg.content as JupyterCommRequest;

		// Get the response from Positron
		const response = await positron.methods.call(request.method, request.params);

		// Send the response back to the kernel
		const reply = new RpcReplyCommand(msg.header, response);
		return this.sendCommand(reply);
	}

	/**
	 * Sends an RPC request to the kernel and waits for a response.
	 *
	 * @param request The request to send
	 * @returns The response from the kernel
	 */
	async sendRequest<T>(request: JupyterRequest<any, T>): Promise<T> {
		// Ensure we're connected before sending the request; if requests are
		// sent before the connection is established, they'll fail
		await this._connected.wait();

		// Add the request to the pending requests map so we can match up the
		// reply when it arrives
		this._pendingRequests.set(request.msgId, request);

		// Send the request over the websocket
		return request.sendRpc(this._socket!);
	}

	/**
	 * Send a command to the kernel. Does not wait for a response.
	 *
	 * @param command The command to send
	 */
	async sendCommand<T>(command: JupyterCommand<T>): Promise<void> {
		// Ensure we're connected before sending the command
		await this._connected.wait();

		// Send the command over the websocket
		return command.sendCommand(this._socket!);
	}

	/**
	 * Begins streaming a log file to the kernel channel.
	 *
	 * @param logFile The path to the log file to stream
	 */
	private streamLogFile(logFile: string) {
		const logStreamer = new LogStreamer(this._kernelChannel, logFile, this.runtimeMetadata.languageName);
		this._disposables.push(logStreamer);
		this._kernelLogFile = logFile;
		logStreamer.watch();
	}

	/**
	 * Begins streaming a profile file to the kernel channel.
	 *
	 * @param profileFilePath The path to the profile file to stream
	 */
	private streamProfileFile(profileFilePath: string) {

		this._profileChannel = positron.window.createRawLogOutputChannel(
			this.metadata.notebookUri ?
				`Notebook: Profiler ${path.basename(this.metadata.notebookUri.path)} (${this.runtimeMetadata.runtimeName})` :
				`Positron ${this.runtimeMetadata.languageName} Profiler`);

		this.log('Streaming profile file: ' + profileFilePath, vscode.LogLevel.Debug);

		const profileStreamer = new LogStreamer(this._profileChannel, profileFilePath);
		this._disposables.push(profileStreamer);

		profileStreamer.watch();
	}

	/**
	 * Emits a message to the the log channel
	 *
	 * @param msg The message to log
	 */
	public log(msg: string, logLevel?: vscode.LogLevel) {
		// Ensure message isn't over the maximum length
		if (msg.length > 2048) {
			msg = msg.substring(0, 2048) + '... (truncated)';
		}

		switch (logLevel) {
			case vscode.LogLevel.Error:
				this._consoleChannel.error(msg);
				break;
			case vscode.LogLevel.Warning:
				this._consoleChannel.warn(msg);
				break;
			case vscode.LogLevel.Info:
				this._consoleChannel.info(msg);
				break;
			default:
				this._consoleChannel.appendLine(msg);
		}
	}

	/**
	 * Creates a short, unique ID. Use to help create unique identifiers for
	 * comms, messages, etc.
	 *
	 * @returns An 8-character unique ID, like `a1b2c3d4`
	 */
	private createUniqueId(): string {
		return Math.floor(Math.random() * 0x100000000).toString(16);
	}
}
