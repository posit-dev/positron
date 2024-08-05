/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { JupyterKernel } from './JupyterKernel';
import { JupyterKernelSpec, JupyterKernelExtra } from './jupyter-adapter';
import { JupyterMessagePacket } from './JupyterMessagePacket';
import { JupyterDisplayData } from './JupyterDisplayData';
import { JupyterExecuteResult } from './JupyterExecuteResult';
import { JupyterExecuteInput } from './JupyterExecuteInput';
import { JupyterKernelInfoReply } from './JupyterKernelInfoReply';
import { JupyterKernelStatus } from './JupyterKernelStatus';
import { JupyterErrorReply } from './JupyterErrorReply';
import { JupyterStreamOutput } from './JupyterStreamOutput';
import { JupyterInputRequest } from './JupyterInputRequest';
import { RuntimeClientAdapter } from './RuntimeClientAdapter';
import { JupyterIsCompleteReply } from './JupyterIsCompleteReply';
import { JupyterRpc } from './JupyterRpc';
import { JupyterIsCompleteRequest } from './JupyterIsCompleteRequest';
import { JupyterKernelInfoRequest } from './JupyterKernelInfoRequest';
import { JupyterHistoryReply } from './JupyterHistoryReply';
import { JupyterHistoryRequest } from './JupyterHistoryRequest';
import { JupyterCommMsg } from './JupyterCommMsg';
import { JupyterCommClose } from './JupyterCommClose';
import { JupyterCommOpen } from './JupyterCommOpen';
import { JupyterCommInfoRequest } from './JupyterCommInfoRequest';
import { JupyterCommInfoReply } from './JupyterCommInfoReply';
import { JupyterExecuteReply } from './JupyterExecuteReply';
import { uuidv4 } from './utils';
import { JupyterCommRequest } from './JupyterCommRequest';
import { JupyterSessionState } from './JupyterSession';
import { JupyterSerializedSession, workspaceStateKey } from './JupyterSessionSerialization';

/**
 * LangaugeRuntimeSessionAdapter wraps a JupyterKernel in a LanguageRuntime
 * compatible interface.
 */
export class LanguageRuntimeSessionAdapter
	implements vscode.Disposable, positron.LanguageRuntimeSession {

	private readonly _kernel: JupyterKernel;
	private readonly _messages: vscode.EventEmitter<positron.LanguageRuntimeMessage>;
	private readonly _state: vscode.EventEmitter<positron.RuntimeState>;
	private readonly _exit: vscode.EventEmitter<positron.LanguageRuntimeExit>;
	private _exitReason: positron.RuntimeExitReason = positron.RuntimeExitReason.Unknown;
	private _kernelState: positron.RuntimeState = positron.RuntimeState.Uninitialized;
	private _restarting = false;
	private static _clientCounter = 0;
	private _disposables: vscode.Disposable[] = [];

	/** A map of message IDs that are awaiting responses to RPC handlers to invoke when a response is received */
	private readonly _pendingRpcs: Map<string, JupyterRpc<any, any>> = new Map();

	/**
	 * Map of comm IDs to RuntimeClientAdapters, which wrap comm channels.
	 *
	 * Consider: This will need to be rethought if we want to support
	 * reattaching to a running kernel. In that case, this map will need
	 * to get populated by asking the kernel, after connecting, for the
	 * list of comms that are currently open.
	 */
	private readonly _comms: Map<string, RuntimeClientAdapter> = new Map();

	/**
	 * Create a new LanguageRuntimeSessionAdapter to wrap a Jupyter kernel session in
	 * a LanguageRuntimeSession interface.
	 *
	 * @param runtimeMetadata The metadata for the language runtime to wrap
	 * @param metadata The metadata for the session to create or reconnect to
	 * @param _context The extension context for the extension that owns this adapter
	 * @param _channel The output channel to use for logging
	 * @param _spec The Jupyter kernel spec for the kernel to wrap
	 * @param dynState The dynamic state of the language runtime
	 * @param extra Extra startup options for the kernel
	 */
	constructor(
		readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
		public readonly metadata: positron.RuntimeSessionMetadata,
		private readonly _context: vscode.ExtensionContext,
		private readonly _channel: vscode.OutputChannel,
		private readonly _spec: JupyterKernelSpec,
		public dynState: positron.LanguageRuntimeDynState,
		extra?: JupyterKernelExtra,
	) {
		this._kernel = new JupyterKernel(
			this._context,
			this._spec,
			runtimeMetadata.runtimeId,
			this._channel,
			metadata.notebookUri,
			extra
		);
		this._channel.appendLine(`Created session ${metadata.sessionId}: ` +
			` for kernel ${JSON.stringify(this.runtimeMetadata)}`);

		// Create emitter for LanguageRuntime messages and state changes
		this._messages = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();
		this._state = new vscode.EventEmitter<positron.RuntimeState>();
		this._exit = new vscode.EventEmitter<positron.LanguageRuntimeExit>();
		this.onDidReceiveRuntimeMessage = this._messages.event;
		this.onDidChangeRuntimeState = this._state.event;
		this.onDidEndSession = this._exit.event;

		// Bind to message stream from kernel
		this.onMessage = this.onMessage.bind(this);
		this._kernel.addListener('message', this.onMessage);

		// Bind to status stream from kernel
		this.onStatus = this.onStatus.bind(this);
		this._kernel.addListener('status', this.onStatus);

		// Bind to the kernel's exit event
		this.onKernelExited = this.onKernelExited.bind(this);
		this._kernel.addListener('exit', this.onKernelExited);
	}

	async callMethod(method: string, ...args: any[]): Promise<any> {
		// Find the UI comm
		const uiComm = Array.from(this._comms.values())
			.find(c => c.getClientType() === positron.RuntimeClientType.Ui);
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

		// Return a promise that resolves when the server side of the UI
		// comm replies. Rejects if either an error is returned from the backend
		// or we are unsuccessful in sending the request.
		let response = {} as any;
		try {
			// Send the request and wait for a response
			response = await uiComm.performRpc(request);
		} catch (err) {
			// Convert the error to a runtime method error. This handles errors
			// that occur while performing the RPC; if the RPC is successfully
			// sent and a response received, errors named in the response are
			// handled below.
			const error: positron.RuntimeMethodError = {
				code: positron.RuntimeMethodErrorCode.InternalError,
				message: err.message,
				name: err.name,
				data: err, // Wrap the underlying error in a data object
			};
			throw error;
		}

		// If the response is an error, throw it
		if (Object.keys(response).includes('error')) {
			const error = response.error;

			// Populate the error object with the name of the error code
			// for conformity with code that expects an Error object.
			error.name = `RPC Error ${response.error.code}`;

			throw error;
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

			throw error;
		}

		// Otherwise, return the result
		return response.result;
	}

	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>;
	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>;
	onDidEndSession: vscode.Event<positron.LanguageRuntimeExit>;

	/**
	 * Executes a fragment of code in the kernel.
	 *
	 * @param code The code to execute.
	 * @param id A unique execution ID supplied by the caller; this is used to
	 *   correlate the execution with the results in subsequent messages.
	 * @param mode The execution mode.
	 * @param errorBehavior The error behavior.
	 */
	public execute(code: string,
		id: string,
		mode: positron.RuntimeCodeExecutionMode,
		errorBehavior: positron.RuntimeErrorBehavior): void {

		this._kernel.log(`Sending code to ${this.runtimeMetadata.languageName}: ${code}`);

		// Forward execution request to the kernel
		this._kernel.execute(code, id, mode, errorBehavior);
	}

	/**
	 * Emits a message into the Jupyter kernel's log channel.
	 *
	 * @param message The message to emit to the log
	 */
	public emitJupyterLog(message: string): void {
		this._kernel.log(message);
	}

	/**
	 * Sets the Jupyter session state (connection parameters); typically used to
	 * re-establish a connection to a running kernel.
	 */
	restoreSession(state: JupyterSessionState): void {
		this._kernel.restoreSession(state);
	}

	/**
	 * Tests whether a code fragment is complete.
	 *
	 * @param code The code fragment to check.
	 * @returns A Thenable that resolves to the status of the code fragment.
	 */
	public isCodeFragmentComplete(code: string): Thenable<positron.RuntimeCodeFragmentStatus> {
		return new Promise<positron.RuntimeCodeFragmentStatus>((resolve, _reject) => {
			// Create an RPC to send to the kernel
			const rpc = new JupyterRpc<JupyterIsCompleteRequest, JupyterIsCompleteReply>(
				'is_complete_request', { code: code },
				'is_complete_reply', (response: JupyterIsCompleteReply) => {
					resolve(response.status as positron.RuntimeCodeFragmentStatus);
				});

			// Send the RPC to the kernel and wait for a response
			this._pendingRpcs.set(rpc.id, rpc);
			rpc.send(this._kernel);
		});
	}

	/**
	 * Replies to an input prompt from the kernel.
	 *
	 * @param id The ID of the prompt to which user responded
	 * @param reply The user's response
	 */
	public replyToPrompt(id: string, reply: string): void {
		this._kernel.log(`Sending reply to prompt ${id}: ${reply}`);
		this._kernel.replyToPrompt(id, reply);
	}

	/**
	 * Interrupts the kernel.
	 */
	public async interrupt(): Promise<void> {
		// Ensure kernel is in an interruptible state
		if (this._kernelState === positron.RuntimeState.Uninitialized) {
			throw new Error('Cannot interrupt kernel; it has not started.');
		}
		if (this._kernelState === positron.RuntimeState.Exited) {
			throw new Error('Cannot interrupt kernel; it has already exited.');
		}

		this._kernel.log(`Interrupting ${this.runtimeMetadata.languageName}`);
		return this._kernel.interrupt();
	}

	/**
	 * Starts a new instance of the language runtime.
	 *
	 * @returns A promise with information about the newly started runtime.
	 */
	public start(): Thenable<positron.LanguageRuntimeInfo> {
		// If the kernel is already ready, return its info
		if (this._kernel.status() === positron.RuntimeState.Ready) {
			return this.getKernelInfo();
		}

		// If not, start the kernel
		return this.startKernel();
	}

	private async startKernel(): Promise<positron.LanguageRuntimeInfo> {
		// Initialize the exit reason to Startup Failed, in case the kernel
		// exits during startup
		this._exitReason = positron.RuntimeExitReason.StartupFailed;

		// Wait for the kernel to start
		await this._kernel.start();

		// We are now online; initialize the exit reason to Unknown so that if an
		// unexpected exit occurs at any point, it will be marked appropriately.
		this._exitReason = positron.RuntimeExitReason.Unknown;
		return this.getKernelInfo();
	}

	/**
	 * Gets information about the kernel.
	 *
	 * @returns A promise with information about the kernel.
	 */
	private getKernelInfo(): Promise<positron.LanguageRuntimeInfo> {
		return new Promise<positron.LanguageRuntimeInfo>((resolve, _reject) => {
			// Create an RPC to send to the kernel requesting kernel info
			const rpc = new JupyterRpc<JupyterKernelInfoRequest, JupyterKernelInfoReply>(
				'kernel_info_request', {},
				'kernel_info_reply', (message: JupyterKernelInfoReply) => {
					resolve({
						banner: message.banner,
						implementation_version: message.implementation_version,
						language_version: message.language_info.version,
						input_prompt: message.language_info.positron?.input_prompt,
						continuation_prompt: message.language_info.positron?.continuation_prompt,
					} satisfies positron.LanguageRuntimeInfo);
				});

			// Send the RPC to the kernel and wait for a response
			this._pendingRpcs.set(rpc.id, rpc);
			rpc.send(this._kernel);
		});
	}

	/**
	 * Restarts the kernel.
	 */
	public async restart(): Promise<void> {
		return this.shutdownKernel(positron.RuntimeExitReason.Restart);
	}

	/**
	 * Shuts down the kernel permanently.
	 */
	public async shutdown(exitReason: positron.RuntimeExitReason): Promise<void> {
		return this.shutdownKernel(exitReason);
	}

	/**
	 * Forcibly terminates the kernel.
	 */
	forceQuit(): Promise<void> {
		// Ensure we mark this as a forced exit when the kernel exits
		this._exitReason = positron.RuntimeExitReason.ForcedQuit;
		return this._kernel.forceQuit();
	}

	/**
	 *
	 * @param restart Whether to shut down in preparation for a restart.
	 * @returns A promise that resolves when the kernel has been instructed to
	 *   shut down (not necessarily when it has exited)
	 */
	private async shutdownKernel(exitReason: positron.RuntimeExitReason): Promise<void> {
		// Ensure the kernel is in a running state before allowing the shutdown
		if (this._kernelState !== positron.RuntimeState.Idle &&
			this._kernelState !== positron.RuntimeState.Busy &&
			this._kernelState !== positron.RuntimeState.Ready) {
			return Promise.reject(new Error('Cannot shut down kernel; it is not (yet) running.' +
				` (state = ${this._kernelState})`));
		}

		const restart = exitReason === positron.RuntimeExitReason.Restart;
		this._restarting = restart;
		this._exitReason = exitReason;

		try {
			await this._kernel.shutdown(restart);

			if (exitReason === positron.RuntimeExitReason.Shutdown ||
				exitReason === positron.RuntimeExitReason.ForcedQuit) {
				// After the session has been permanently shut down, clean up its
				// storage key
				this._context.workspaceState.update(
					workspaceStateKey(this.runtimeMetadata, this.metadata),
					undefined);
			}
		} catch (err) {
			// If we failed to request a shutdown, reset the exit reason
			this._exitReason = positron.RuntimeExitReason.Unknown;
			throw err;
		}
	}

	/**
	 * Show runtime log in output panel.
	 */
	public showOutput() {
		this._kernel.showOutput();
	}

	/**
	 * Show profiler log in output panel.
	 */
	public async showProfile() {
		await this._kernel.showProfile();
	}

	/**
	 * Creates a new client instance.
	 *
	 * @param id The client-supplied ID of the client to create
	 * @param type The type of client to create
	 * @param params The parameters for the client; the format of this object is
	 *   specific to the client type
	 * @param metadata The metadata for the client; the format of this object is
	 *   specific to the client type
	 */
	public async createClient(
		id: string,
		type: positron.RuntimeClientType,
		params: object,
		metadata?: object,
	) {

		// Ensure the type of client we're being asked to create is a known type that supports
		// client-initiated creation
		if (type === positron.RuntimeClientType.Variables ||
			type === positron.RuntimeClientType.Lsp ||
			type === positron.RuntimeClientType.Dap ||
			type === positron.RuntimeClientType.Ui ||
			type === positron.RuntimeClientType.Help ||
			type === positron.RuntimeClientType.IPyWidgetControl) {
			this._kernel.log(`Creating '${type}' client for ${this.runtimeMetadata.languageName}`);

			// Does the comm wrap a server? In that case the
			// promise should only resolve when the server is
			// ready to accept connections
			const server_comm = type === positron.RuntimeClientType.Lsp;

			// Create a new client adapter to wrap the comm channel
			const adapter = new RuntimeClientAdapter(id, type, params, this._kernel, server_comm, metadata);

			// Add the client to the map. Note that we have to do this before opening
			// the instance, because we may need to process messages from the client
			// before the open call completes due to message ordering.
			this._comms.set(id, adapter);

			// Ensure we clean up the client from our internal state when it disconnects
			adapter.onDidChangeClientState((e) => {
				if (e === positron.RuntimeClientState.Closed) {
					if (!this._comms.delete(adapter.getId())) {
						this._kernel.log(`Warn: Runtime client adapater ${adapter.getId()} (${adapter.getClientType()}) not found`);
					}
				}
			});

			// Open the client (this will send the comm_open message; wait for it to complete)
			try {
				await adapter.open();
			} catch (err) {
				this._kernel.log(`Info: error while creating ${type} client for ${this.runtimeMetadata.languageName}: ${err}`);
				this.removeClient(id);
			}
		} else {
			this._kernel.log(`Info: can't create ${type} client for ${this.runtimeMetadata.languageName} (not supported)`);
		}
	}

	/**
	 * Removes a client instance.
	 *
	 * @param id The ID of the client to remove
	 */
	removeClient(id: string): void {
		const comm = this._comms.get(id);
		if (comm) {
			// This is one of the clients we created, so we need to dispose of it
			this._kernel.log(`Removing "${comm.getClientType()}" client ${comm.getClientId()} for ${this.runtimeMetadata.languageName}`);
			comm.dispose();
		} else {
			// This is a client created on the back end, so we just need to send a
			// comm_close message
			this._kernel.log(`Closing client ${id} for ${this.runtimeMetadata.languageName}`);
			this._kernel.closeComm(id);
		}
	}

	/**
	 * Lists the clients of a given type.
	 *
	 * @param type The type of client to list, or undefined to list all clients
	 * @returns A record of client IDs to client types
	 */
	listClients(type?: positron.RuntimeClientType): Thenable<Record<string, string>> {
		return new Promise<Record<string, string>>((resolve, _reject) => {
			// Create an RPC to send to the kernel requesting the list of clients
			const rpc = new JupyterRpc<JupyterCommInfoRequest, JupyterCommInfoReply>(
				'comm_info_request',
				{
					target_name: type ? type : '',
				},
				'comm_info_reply', (response: JupyterCommInfoReply) => {
					const comms = response.comms;
					// Create the result object
					const result: Record<string, string> = {};

					// Unwrap the comm info and add it to the result
					for (const key in comms) {
						if (comms.hasOwnProperty(key)) {
							result[key] = comms[key].target_name;
						}
					}
					resolve(result);
				});

			// Send the RPC to the kernel and wait for a response
			this._pendingRpcs.set(rpc.id, rpc);
			rpc.send(this._kernel);
		});
	}

	/**
	 * Sends a message to the back end of a client instance.
	 *
	 * @param client_id The ID of the client to send the message to
	 * @param message_id The ID of the message to send (unique per message)
	 * @param message The message payload to send
	 */
	sendClientMessage(client_id: string, message_id: string, message: any): void {
		this._kernel.sendCommMessage(client_id, message_id, message);
	}

	/**
	 * Gets the history of inputs to (and, optionally, outputs from) the kernel.
	 *
	 * Note that this is not currently used by Positron, which keeps its own
	 * execution records in order to free individual language runtimes from the
	 * burden of doing so.
	 *
	 * @param includeOutput Whether to include output in the history
	 * @param max The maximum number of entries to return. If 0, returns all
	 *  entries (not recommended; may be slow)
	 */
	getExecutionHistory(includeOutput: boolean, max: number): Thenable<string[][]> {
		return new Promise<string[][]>((resolve, _reject) => {
			// Create an RPC to send to the kernel requesting history
			const rpc = new JupyterRpc<JupyterHistoryRequest, JupyterHistoryReply>(
				'history_request',
				{
					output: includeOutput,
					raw: true,
					hist_access_type: 'tail',
					n: max
				},
				'history_reply', (response: JupyterHistoryReply) => {
					resolve(response.history);
				});

			// Send the RPC to the kernel and wait for a response
			this._pendingRpcs.set(rpc.id, rpc);
			rpc.send(this._kernel);
		});
	}

	onMessage(msg: JupyterMessagePacket) {
		const message = msg.message;

		// Is the message's parent ID in the set of pending RPCs and is the
		// message the expected response type? (Note that a single Request type
		// can generate multiple replies, only one of which is the Reply type)
		//
		// If so, we'll complete the RPC and remove the callback.
		const rpc = this._pendingRpcs.get(msg.originId);
		if (rpc && rpc.responseType === msg.msgType) {
			// Clear the callback before invoking it, in case the callback
			// throws an exception.
			this._pendingRpcs.delete(msg.originId);
			rpc.recv(msg.message);
		}

		switch (msg.msgType) {
			case 'display_data':
				this.onDisplayData(msg, message as JupyterDisplayData);
				break;
			case 'error':
				this.onErrorResult(msg, message as JupyterErrorReply);
				break;
			case 'execute_result':
				this.onExecuteResult(msg, message as JupyterExecuteResult);
				break;
			case 'execute_reply':
				this.onExecuteReply(msg, message as JupyterExecuteReply);
				break;
			case 'execute_input':
				this.onExecuteInput(msg, message as JupyterExecuteInput);
				break;
			case 'stream':
				this.onStreamOutput(msg, message as JupyterStreamOutput);
				break;
			case 'status':
				this.onKernelStatus(msg, message as JupyterKernelStatus);
				break;
			case 'input_request':
				this.onInputRequest(msg, message as JupyterInputRequest);
				break;
			case 'rpc_request':
				this.onRpcRequest(msg, message as JupyterCommRequest);
				break;
			case 'comm_open':
				this.onCommOpen(msg, message as JupyterCommOpen);
				break;
			case 'comm_msg':
				this.onCommMessage(msg, message as JupyterCommMsg);
				break;
			case 'comm_close':
				this.onCommClose(msg, message as JupyterCommClose);
				break;
		}
	}

	/**
	 * Handles an input_request message from the kernel.
	 *
	 * @param message The message packet
	 * @param req The input request
	 */
	private onInputRequest(message: JupyterMessagePacket, req: JupyterInputRequest): void {
		// Send the input request to the client.
		this._messages.fire({
			id: message.msgId,
			parent_id: message.originId,
			when: message.when,
			type: positron.LanguageRuntimeMessageType.Prompt,
			prompt: req.prompt,
			password: req.password,
		} as positron.LanguageRuntimePrompt);
	}

	/**
	 * Handles an rpc_request message from the kernel.
	 *
	 * @param message The message packet
	 * @param req The input request
	 */
	private async onRpcRequest(_message: JupyterMessagePacket, req: JupyterCommRequest): Promise<void> {
		const response = await positron.methods.call(req.method, req.params);
		this._kernel.replyToComm(response);
	}

	/**
	 * Delivers a comm_open message from the kernel to the front end. Typically
	 * this is used to create a front-end representation of a back-end
	 * object, such as an interactive plot or Jupyter widget.
	 *
	 * @param message The outer message packet
	 * @param msg The inner comm_open message
	 */
	private onCommOpen(message: JupyterMessagePacket, msg: JupyterCommOpen): void {
		this._messages.fire({
			id: message.msgId,
			parent_id: message.originId,
			when: message.when,
			type: positron.LanguageRuntimeMessageType.CommOpen,
			comm_id: msg.comm_id,
			target_name: msg.target_name,
			data: msg.data,
			metadata: message.metadata,
		} as positron.LanguageRuntimeCommOpen);
	}

	/**
	 * Delivers a comm_msg message from the kernel to the appropriate client instance.
	 *
	 * @param message The outer message packet
	 * @param msg The inner comm_msg message
	 */
	private onCommMessage(message: JupyterMessagePacket, msg: JupyterCommMsg): void {
		this._messages.fire({
			id: message.msgId,
			parent_id: message.originId,
			when: message.when,
			type: positron.LanguageRuntimeMessageType.CommData,
			comm_id: msg.comm_id,
			data: msg.data,
			metadata: message.metadata,
			buffers: message.buffers,
		} as positron.LanguageRuntimeCommMessage);
	}

	/**
	 * Notifies the client that a comm has been closed from the kernel side.
	 *
	 * @param message The outer message packet
	 * @param close The inner comm_msg message
	 */
	private onCommClose(message: JupyterMessagePacket, msg: JupyterCommMsg): void {
		this._messages.fire({
			id: message.msgId,
			parent_id: message.originId,
			when: message.when,
			type: positron.LanguageRuntimeMessageType.CommClosed,
			comm_id: msg.comm_id,
			data: msg.data,
			metadata: message.metadata,
		} as positron.LanguageRuntimeCommClosed);
	}

	/**
	 * Converts a Jupyter display_data message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The display_data message
	 */
	onDisplayData(message: JupyterMessagePacket, data: JupyterDisplayData) {
		this._messages.fire({
			id: message.msgId,
			parent_id: message.originId,
			when: message.when,
			type: positron.LanguageRuntimeMessageType.Output,
			data: data.data as any,
			metadata: message.metadata,
		} as positron.LanguageRuntimeOutput);
	}

	/**
	 * Converts a Jupyter error message to a LanguageRuntimeMessage and emits
	 * it.
	 *
	 * @param message The message packet
	 * @param data The error message
	 */
	private onErrorResult(message: JupyterMessagePacket, data: JupyterErrorReply) {
		this._messages.fire({
			id: message.msgId,
			parent_id: message.originId,
			when: message.when,
			type: positron.LanguageRuntimeMessageType.Error,
			name: data.ename,
			message: data.evalue,
			traceback: data.traceback,
			metadata: message.metadata,
		} as positron.LanguageRuntimeError);
	}

	/**
	 * Converts a Jupyter execute_result message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The execute_result message
	 */
	onExecuteResult(message: JupyterMessagePacket, data: JupyterExecuteResult) {
		this._messages.fire({
			id: message.msgId,
			parent_id: message.originId,
			when: message.when,
			type: positron.LanguageRuntimeMessageType.Result,
			data: data.data as any,
			metadata: message.metadata,
		} as positron.LanguageRuntimeResult);
	}

	/**
	 * Handles a Jupyter execute_reply message. Currently there is nothing to do as we don't
	 * utilize the execution_count and any execution errors are instead handled by the IOPub 'error'
	 * path.
	 *
	 * @param _message The message packet
	 * @param _data The execute_reply message
	 */
	onExecuteReply(_message: JupyterMessagePacket, _data: JupyterExecuteReply) {

	}

	/**
	 * Converts a Jupyter stream message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The stream message
	 */
	onStreamOutput(message: JupyterMessagePacket, data: JupyterStreamOutput) {
		this._messages.fire({
			id: message.msgId,
			parent_id: message.originId,
			when: message.when,
			type: positron.LanguageRuntimeMessageType.Stream,
			name: data.name,
			text: data.text,
			metadata: message.metadata,
		} as positron.LanguageRuntimeStream);
	}

	/**
	 * Converts a Jupyter execute_input message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The execute_input message
	 */
	onExecuteInput(message: JupyterMessagePacket, data: JupyterExecuteInput) {
		this._messages.fire({
			id: message.msgId,
			parent_id: message.originId,
			when: message.when,
			type: positron.LanguageRuntimeMessageType.Input,
			code: data.code,
			execution_count: data.execution_count,
			metadata: message.metadata,
		} as positron.LanguageRuntimeInput);
	}

	/**
	 * Converts a Jupyter status message to a LanguageRuntimeMessage and emits
	 * it.
	 *
	 * @param message The message packet
	 * @param data The kernel status message
	 */
	onKernelStatus(message: JupyterMessagePacket, data: JupyterKernelStatus) {
		this._messages.fire({
			id: message.msgId,
			parent_id: message.originId,
			when: message.when,
			type: positron.LanguageRuntimeMessageType.State,
			state: data.execution_state,
			metadata: message.metadata,
		} as positron.LanguageRuntimeState);
	}

	/**
	 * Converts a Jupyter status message to a RuntimeState and emits it.
	 *
	 * @param status The new status of the kernel
	 */
	onStatus(status: positron.RuntimeState) {
		const previous = this._kernelState;
		this._kernel.log(`${this._spec.language} kernel status changed: ${previous} => ${status}`);
		this._kernelState = status;
		this._state.fire(status);

		// When the kernel becomes ready, serialize its state for later
		// reconnection
		if (status === positron.RuntimeState.Ready) {
			this.serializeSessionState();
		}
	}

	/**
	 * Runs when the Jupyter kernel exits
	 *
	 * @param exitCode The exit code of the kernel
	 */
	onKernelExited(exitCode: number) {
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

		// If the kernel was restarting, now's the time to bring it back up
		if (this._restarting) {
			this._kernel.clearSession();
			this._restarting = false;
			// Defer the start by 500ms to ensure the kernel has processed its
			// own exit before we ask it to restart. This also ensures that the
			// kernel's status events as it starts up don't overlap with the
			// status events emitted during shutdown (which can happen on the
			// Positron side due to internal buffering in the extension host
			// interface)
			setTimeout(() => {
				this._kernel.start();
			}, 500);
		}
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
		// TODO: Should we query the kernel to see if it can create an LSP
		// (QueryInterface style) instead of just demanding it?
		//
		// The Jupyter kernel spec does not provide a way to query for
		// supported comms; the only way to know is to try to create one.

		// Create a unique client ID for this instance
		const uniqueId = Math.floor(Math.random() * 0x100000000).toString(16);
		const clientId = `positron-lsp-${this.runtimeMetadata.languageId}-${LanguageRuntimeSessionAdapter._clientCounter++}-${uniqueId}`;
		this._kernel.log(`Starting LSP server ${clientId} for ${clientAddress}`);

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
		const clientId = `positron-dap-${this.runtimeMetadata.languageId}-${LanguageRuntimeSessionAdapter._clientCounter++}-${uniqueId}`;
		this._kernel.log(`Starting DAP server ${clientId} for ${serverAddress}`);

		// Notify Positron that we're handling messages from this client
		this._disposables.push(positron.runtime.registerClientInstance(clientId));

		await this.createClient(
			clientId,
			positron.RuntimeClientType.Dap,
			{ client_address: serverAddress }
		);

		// Handle events from the DAP
		const comm = this._comms.get(clientId)!;
		this._disposables.push(comm.onDidReceiveCommMsg(e => {
			const msg = e.data;
			switch (msg.msg_type) {
				// The runtime is in control of when to start a debug session.
				// When this happens, we attach automatically to the runtime
				// with a synthetic configuration.
				case 'start_debug': {
					this._kernel.log(`Starting debug session for DAP server ${clientId}`);
					const config = {
						type: debugType,
						name: debugName,
						request: 'attach',
						debugServer: serverPort,
						internalConsoleOptions: 'neverOpen',
					} as vscode.DebugConfiguration;
					vscode.debug.startDebugging(undefined, config);
					break;
				}

				// If the DAP has commands to execute, such as "n", "f", or "Q",
				// it sends events to let us do it from here.
				case 'execute': {
					this.execute(
						msg.content.command,
						uuidv4(),
						positron.RuntimeCodeExecutionMode.Interactive,
						positron.RuntimeErrorBehavior.Stop
					);
					break;
				}

				// We use the restart button as a shortcut for restarting the runtime
				case 'restart': {
					this.restart();
					break;
				}

				default: {
					this._kernel.log(`Unknown DAP command: ${msg.msg_type}`);
					break;
				}
			}
		}));
	}

	/**
	 * Saves the current state of the session to a workspace storage; used to
	 * persist the session across restarts.
	 */
	private serializeSessionState() {
		const serialized: JupyterSerializedSession = {
			dynState: this.dynState,
			sessionState: this._kernel.getSessionState()!,
			kernelSpec: this._spec,
		};

		this._context.workspaceState.update(
			workspaceStateKey(this.runtimeMetadata, this.metadata),
			serialized);
	}

	/**
	 * Dispose of the runtime.
	 */
	public async dispose() {
		// Turn off all listeners
		this._kernel.removeListener('message', this.onMessage);
		this._kernel.removeListener('status', this.onStatus);

		// Dispose this before the comms since there might be event listeners
		// to dispose of first
		this._disposables.forEach(d => d.dispose());

		// Tear down all open comms
		for (const comm of this._comms.values()) {
			await comm.dispose();
		}

		// Tell the kernel to shut down
		await this._kernel.dispose();
	}

	public getKernelLogFile(): string {
		return this._kernel.getKernelLogFilePath();
	}
}
