/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { JupyterKernelSpec, JupyterLanguageRuntimeSession } from './jupyter-adapter';
import { ActiveSession, DefaultApi, HttpError, InterruptMode, NewSession } from './kcclient/api';
import { WebSocket } from 'ws';
import { JupyterMessage } from './jupyter/JupyterMessage';
import { JupyterRequest } from './jupyter/JupyterRequest';
import { KernelInfoRequest } from './jupyter/KernelInfoRequest';
import { Barrier, PromiseHandles } from './async';
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

export class KallichoreSession implements JupyterLanguageRuntimeSession {
	private readonly _messages: RuntimeMessageEmitter = new RuntimeMessageEmitter();
	private readonly _state: vscode.EventEmitter<positron.RuntimeState>;
	private readonly _exit: vscode.EventEmitter<positron.LanguageRuntimeExit>;
	private readonly _established: Barrier = new Barrier();
	private _connected: Barrier = new Barrier();
	private _ready: Barrier = new Barrier();
	private _exitReason: positron.RuntimeExitReason = positron.RuntimeExitReason.Unknown;
	private _ws: WebSocket | undefined;
	private _runtimeState: positron.RuntimeState = positron.RuntimeState.Uninitialized;
	private _pendingRequests: Map<string, JupyterRequest<any, any>> = new Map();
	private _disposables: vscode.Disposable[] = [];
	private readonly _log: vscode.OutputChannel;
	private _restarting = false;
	private _dapClient: DapClient | undefined;

	private readonly _comms: Map<string, Comm> = new Map();

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
		private _new: boolean
	) {
		// Create event emitters
		this._state = new vscode.EventEmitter<positron.RuntimeState>();
		this._exit = new vscode.EventEmitter<positron.LanguageRuntimeExit>();

		this.onDidReceiveRuntimeMessage = this._messages.event;

		this.onDidChangeRuntimeState = this._state.event;

		this.onDidEndSession = this._exit.event;

		// Create a log channel for this session
		this._log = positron.window.createRawLogOutputChannel(
			metadata.notebookUri ?
				`Notebook: ${path.basename(metadata.notebookUri.path)} (${runtimeMetadata.runtimeName})` :
				`Console: ${runtimeMetadata.runtimeName}`);
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

		// If we have a notebook URI, use its directory as the working directory
		// instead
		if (this.metadata.notebookUri?.fsPath) {
			workingDir = this.metadata.notebookUri.fsPath;
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

		// Create the session in the underlying API
		const session: NewSession = {
			argv: args,
			sessionId: this.metadata.sessionId,
			language: kernelSpec.language,
			displayName: this.metadata.sessionName,
			env,
			workingDirectory: workingDir,
			username: os.userInfo().username,
			interruptMode
		};

		await this._api.newSession(session);
		this.log(`Session created: ${JSON.stringify(session)}`);
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
		const uniqueId = Math.floor(Math.random() * 0x100000000).toString(16);
		const clientId = `positron-lsp-${this.runtimeMetadata.languageId}-${uniqueId}`;
		this.log(`Starting LSP server ${clientId} for ${clientAddress}`);

		// Notify Positron that we're handling messages from this client
		this._disposables.push(positron.runtime.registerClientInstance(clientId));

		await this.createClient(
			clientId,
			positron.RuntimeClientType.Lsp,
			{ client_address: clientAddress }
		);
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
		const uniqueId = Math.floor(Math.random() * 0x100000000).toString(16);
		const clientId = `positron-dap-${this.runtimeMetadata.languageId}-${uniqueId}`;
		this.log(`Starting DAP server ${clientId} for ${serverAddress}`);

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

	emitJupyterLog(message: string): void {
		this.log(message);
	}

	showOutput(): void {
		this._log.show();
	}

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

		const uniqueId = Math.floor(Math.random() * 0x100000000).toString(16);
		const commRequest = new CommMsgRequest(uniqueId, commMsg);
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
		});

		return promise.promise;
	}

	getKernelLogFile(): string {
		throw new Error('Method not implemented.');
	}

	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>;

	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>;

	onDidEndSession: vscode.Event<positron.LanguageRuntimeExit>;

	execute(code: string,
		id: string,
		mode: positron.RuntimeCodeExecutionMode,
		errorBehavior: positron.RuntimeErrorBehavior): void {

		const request: JupyterExecuteRequest = {
			code,
			silent: mode === positron.RuntimeCodeExecutionMode.Silent,
			store_history: mode === positron.RuntimeCodeExecutionMode.Interactive,
			user_expressions: new Map(),
			allow_stdin: true,
			stop_on_error: errorBehavior === positron.RuntimeErrorBehavior.Stop,
		};
		const execute = new ExecuteRequest(id, request);
		this.sendRequest(execute).then((reply) => {
			this.log(`Execution result: ${JSON.stringify(reply)}`);
		});
	}

	async isCodeFragmentComplete(code: string): Promise<positron.RuntimeCodeFragmentStatus> {
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

	async createClient(id: string, type: positron.RuntimeClientType, params: any, _metadata?: any): Promise<void> {

		// TODO: handle metadata

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
			const commOpen = new CommOpenCommand(msg);
			await this.sendCommand(commOpen);
			this._comms.set(id, new Comm(id, type));
		} else {
			this.log(`Can't create ${type} client for ${this.runtimeMetadata.languageName} (not supported)`);
		}
	}

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
				this._comms.set(key, new Comm(key, target));
			}
		}
		return result;
	}

	removeClient(id: string): void {
		const commOpen = new CommCloseCommand(id);
		this.sendCommand(commOpen);
	}

	sendClientMessage(client_id: string, message_id: string, message: any): void {
		const msg: JupyterCommMsg = {
			comm_id: client_id,
			data: message
		};
		const commMsg = new CommMsgCommand(message_id, msg);
		this.sendCommand(commMsg);
	}

	replyToPrompt(id: string, value: string): void {
		if (!this._activeBackendRequestHeader) {
			this.log(`WARN: Failed to find parent for input request ${id}; sending anyway: ${value}`);
			return;
		}
		const reply = new InputReplyCommand(this._activeBackendRequestHeader, value);
		this.log(`Sending input reply for ${id}: ${value}`);
		this.sendCommand(reply);
	}

	public replyToComm(response: any) {
		// NOTE: Currently we only support synchronous reverse requests
		// from R via the frontend comm. Since this mechanism is
		// synchronous, there cannot be concurrent requests and we can
		// share the active request header with `input_request`. We will
		// need a map of active requests if we extend to support
		// asynchronous requests from other comms.
		const parent = this._activeBackendRequestHeader;

		if (!parent) {
			this.log(`ERROR: Failed to find parent for comm request ${response.id}`);
			return;
		}

		const reply = new RpcReplyCommand(parent, response);
		this.sendCommand(reply);
	}

	async restore(session: ActiveSession) {
		// Re-establish the log stream by looking for the `--log` argument.
		//
		// CONSIDER: This is a convention used by the R kernel. We could handle it more
		// generically by storing this information in the session metadata.
		const logFileIndex = session.argv.indexOf('--log');
		if (logFileIndex > 0 && logFileIndex < session.argv.length - 1) {
			const logFile = session.argv[logFileIndex + 1];
			if (fs.existsSync(logFile)) {
				this.streamLogFile(logFile);
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
		this._established.open();
	}

	async start(): Promise<positron.LanguageRuntimeInfo> {
		// Wait for the session to be established before connecting. This
		// ensures either that we've created the session (if it's new) or that
		// we've restored it (if it's not new).
		await this._established.wait();

		// If it's a new session, wait for it to be created before connecting
		if (this._new) {

			// Wait for the session to start
			try {
				await this._api.startSession(this.metadata.sessionId);
			} catch (err) {
				if (err instanceof HttpError) {
					throw new Error(err.body.message);
				} else {
					// Rethrow the error as-is if it's not an HTTP error
					throw err;
				}
			}
		}

		// Connect to the session's websocket
		await this.connect();

		if (this._new) {
			// If this is a new session, wait for it to be ready before
			// returning
			await this._ready.wait();
		} else {
			// If it's not a new session, enter the ready state immediately.
			// TODO: this should actually wait for the kernel to be ready; what
			// if it's busy?
			this._ready.open();
			this._state.fire(positron.RuntimeState.Ready);
		}

		return this.getKernelInfo();
	}

	connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			// Ensure websocket is closed if it's open
			if (this._ws) {
				this._ws.close();
			}

			// Connect to the session's websocket
			const uri = vscode.Uri.parse(this._api.basePath);
			this._ws = new WebSocket(`ws://${uri.authority}/sessions/${this.metadata.sessionId}/channels`);
			this._ws.onopen = () => {
				this.log(`Connected to websocket.`);
				// Open the connected barrier so that we can start sending messages
				this._connected.open();
				resolve();
			};
			this._ws.onerror = (err: any) => {
				this.log(`Error connecting to socket: ${err}`);
				reject(err);

				// TODO: Needs to take kernel down if this happens due to the
				// connection getting closed from the server
			};
			this._ws.onmessage = (msg: any) => {
				this.log(`RECV message: ${msg.data}`);
				try {
					const data = JSON.parse(msg.data.toString());
					this.handleMessage(data);
				} catch (err) {
					this.log(`Could not parse message: ${err}`);
				}
			};
		});
	}

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

	async restart(): Promise<void> {
		this._exitReason = positron.RuntimeExitReason.Restart;
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

	async shutdown(exitReason: positron.RuntimeExitReason): Promise<void> {
		this._exitReason = exitReason;
		this.performShutdown(exitReason === positron.RuntimeExitReason.Restart);
	}

	async performShutdown(restart: boolean) {
		const shutdownRequest = new ShutdownRequest(restart);
		await this.sendRequest(shutdownRequest);
		this._restarting = restart;
	}

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

	showProfile?(): Thenable<void> {
		throw new Error('Method not implemented.');
	}

	dispose() {
		this._disposables.forEach(d => d.dispose());

		// Close the websocket if it's open
		this._ws?.close();
	}

	handleMessage(data: any) {
		if (!data.kind) {
			this.log(`Kallichore session ${this.metadata.sessionId} message has no kind: ${data}`);
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

	handleKernelMessage(data: any) {
		if (data.hasOwnProperty('status')) {
			// Check to see if the status is a valid runtime state
			if (Object.values(positron.RuntimeState).includes(data.status)) {
				this.onStateChange(data.status);
			} else {
				this.log(`Unknown state: ${data.status}`);
			}
		} else if (data.hasOwnProperty('exited')) {
			this.onExited(data.exited);
		}
	}

	private onStateChange(newState: positron.RuntimeState) {
		// If the kernel is ready, open the ready barrier
		if (newState === positron.RuntimeState.Ready) {
			this.log(`Received initial heartbeat; kernel is ready.`);
			this._ready.open();
		}
		this.log(`State: ${this._runtimeState} => ${newState}`);
		if (newState === positron.RuntimeState.Offline) {
			// Close the connected barrier if the kernel is offline
			this._connected = new Barrier();
		}
		if (this._runtimeState === positron.RuntimeState.Offline &&
			newState !== positron.RuntimeState.Exited &&
			newState === positron.RuntimeState.Offline) {
			// The kernel was offline but is back online; open the connected
			// barrier
			this.log(`The kernel is back online.`);
			this._connected.open();
		}
		if (newState === positron.RuntimeState.Starting) {
			this.log(`The kernel has started up after a restart.`);
			this._restarting = false;
		}
		this._runtimeState = newState;
		this._state.fire(newState);
	}

	private onExited(exitCode: number) {
		if (this._restarting) {
			// If we're restarting, wait for the kernel to start up again
			this.log(`Kernel exited with code ${exitCode}; waiting for restart to finish.`);
		} else {
			// If we aren't going to be starting up again, clean up the session
			// websocket
			this.log(`Kernel exited with code ${exitCode}; cleaning up.`);
			this._ws?.close();
			this._ws = undefined;
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

	async getKernelInfo(): Promise<positron.LanguageRuntimeInfo> {
		const request = new KernelInfoRequest();
		const reply = await this.sendRequest(request);
		const info: positron.LanguageRuntimeInfo = {
			banner: reply.banner,
			implementation_version: reply.implementation_version,
			language_version: reply.language_info.version,
		};
		return info;
	}

	handleJupyterMessage(data: any) {
		const msg = data as JupyterMessage;

		// Check to see if the message is a reply to a request
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
						this.log(`Handled comm request: ${JSON.stringify(msg.content)}`);
					});
					break;
				}
			}
		}

		// If we have a DAP client active and this is a comm message, forward the message to the DAP client
		if (this._dapClient && msg.header.msg_type === 'comm_msg') {
			const commMsg = msg.content as JupyterCommMsg;
			const comm = this._comms.get(commMsg.comm_id);
			if (comm && comm.id === this._dapClient.clientId) {
				this._dapClient.handleDapMessage(commMsg.data);
			}
		}

		// Translate the Jupyter message to a LanguageRuntimeMessage and emit it
		this._messages.emitJupyter(msg);
	}

	async onCommRequest(msg: JupyterMessage): Promise<void> {
		const request = msg.content as JupyterCommRequest;
		const response = await positron.methods.call(request.method, request.params);
		const reply = new RpcReplyCommand(msg.header, response);
		this.sendCommand(reply);
	}

	async sendRequest<T>(request: JupyterRequest<any, T>): Promise<T> {
		await this._connected.wait();
		this._pendingRequests.set(request.msgId, request);
		return request.sendRpc(this.metadata.sessionId, this._ws!);
	}

	async sendCommand<T>(command: JupyterCommand<T>) {
		await this._connected.wait();
		return command.sendCommand(this.metadata.sessionId, this._ws!);
	}

	private streamLogFile(logFile: string) {
		const logStreamer = new LogStreamer(this._log, logFile, this.runtimeMetadata.languageName);
		this._disposables.push(logStreamer);
		logStreamer.watch();
	}

	private streamProfileFile(profileFilePath: string) {

		const profileChannel = positron.window.createRawLogOutputChannel(
			this.metadata.notebookUri ?
				`Notebook: Profiler ${path.basename(this.metadata.notebookUri.path)} (${this.runtimeMetadata.runtimeName})` :
				`Positron ${this.runtimeMetadata.languageName} Profiler`);

		this.log('Streaming profile file: ' + profileFilePath);

		const profileStreamer = new LogStreamer(profileChannel, profileFilePath);
		this._disposables.push(profileStreamer);

		profileStreamer.watch();
	}

	public log(msg: string) {
		// Ensure message isn't over the maximum length
		if (msg.length > 2048) {
			msg = msg.substring(0, 2048) + '... (truncated)';
		}
		this._log.appendLine(`[Positron] ${msg}`);
	}

}
