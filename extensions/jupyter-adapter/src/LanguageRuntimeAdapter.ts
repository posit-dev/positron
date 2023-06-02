/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { JupyterKernel } from './JupyterKernel';
import { JupyterKernelSpec } from './jupyter-adapter';
import { JupyterMessagePacket } from './JupyterMessagePacket';
import { JupyterDisplayData } from './JupyterDisplayData';
import { JupyterExecuteResult } from './JupyterExecuteResult';
import { JupyterExecuteInput } from './JupyterExecuteInput';
import { JupyterKernelInfoReply } from './JupyterKernelInfoReply';
import { JupyterKernelStatus } from './JupyterKernelStatus';
import { JupyterErrorReply } from './JupyterErrorReply';
import { JupyterStreamOutput } from './JupyterStreamOutput';
import { PositronEvent } from './PositronEvent';
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

/**
 * LangaugeRuntimeAdapter wraps a JupyterKernel in a LanguageRuntime compatible interface.
 */
export class LanguageRuntimeAdapter
	implements vscode.Disposable, positron.LanguageRuntime {

	private readonly _kernel: JupyterKernel;
	private readonly _messages: vscode.EventEmitter<positron.LanguageRuntimeMessage>;
	private readonly _state: vscode.EventEmitter<positron.RuntimeState>;
	private _kernelState: positron.RuntimeState = positron.RuntimeState.Uninitialized;
	private _restarting = false;
	private static _clientCounter = 0;

	/** A map of message IDs that are awaiting responses to RPC handlers to invoke when a response is received */
	private readonly _pendingRpcs: Map<string, JupyterRpc<any, any>> = new Map();

	/** A set of message IDs that represent busy messages for which no corresponding idle message has yet been received */
	private readonly _busyMessageIds: Set<string> = new Set();

	/** A set of message IDs that represent idle messages for which no corresponding busy message has yet been received */
	private readonly _idleMessageIds: Set<string> = new Set();

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
	 * Create a new LanguageRuntimeAdapter to wrap a Jupyter kernel instance in
	 * a LanguageRuntime interface.
	 *
	 * @param _context The extension context for the extension that owns this adapter
	 * @param _channel The output channel to use for logging
	 * @param _spec The Jupyter kernel spec for the kernel to wrap
	 * @param metadata The metadata for the language runtime to wrap
	 */
	constructor(private readonly _context: vscode.ExtensionContext,
		private readonly _channel: vscode.OutputChannel,
		private readonly _spec: JupyterKernelSpec,
		readonly metadata: positron.LanguageRuntimeMetadata,
	) {
		this._kernel = new JupyterKernel(this._context,
			this._spec,
			metadata.runtimeId,
			this._channel);
		this._channel.appendLine('Registered kernel: ' + JSON.stringify(this.metadata));

		// Create emitter for LanguageRuntime messages and state changes
		this._messages = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();
		this._state = new vscode.EventEmitter<positron.RuntimeState>();
		this.onDidReceiveRuntimeMessage = this._messages.event;
		this.onDidChangeRuntimeState = this._state.event;

		// Bind to message stream from kernel
		this.onMessage = this.onMessage.bind(this);
		this._kernel.addListener('message', this.onMessage);

		// Bind to status stream from kernel
		this.onStatus = this.onStatus.bind(this);
		this._kernel.addListener('status', this.onStatus);
	}

	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>;
	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>;

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

		this._kernel.log(`Sending code to ${this.metadata.languageName}: ${code}`);

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

		if (this._kernelState === positron.RuntimeState.Exiting ||
			this._kernelState === positron.RuntimeState.Exited) {
			throw new Error('Cannot interrupt kernel; it has already exited.');
		}

		this._kernel.log(`Interrupting ${this.metadata.languageName}`);

		// We are interrupting the kernel, so it's possible that message IDs
		// that are currently being processed will never be completed. Clear the
		// queue.
		this._busyMessageIds.clear();
		this._idleMessageIds.clear();

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
		await this._kernel.start();
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
		return this._kernel.shutdown(true);
	}

	/**
	 * Shuts down the kernel permanently.
	 */
	public async shutdown(): Promise<void> {
		return this._kernel.shutdown(false);
	}

	/**
	 * Creates a new client instance.
	 *
	 * @param id The client-supplied ID of the client to create
	 * @param type The type of client to create
	 * @param params The parameters for the client; the format of this object is
	 *   specific to the client type
	 */
	public async createClient(id: string,
		type: positron.RuntimeClientType,
		params: object) {

		if (type === positron.RuntimeClientType.Environment ||
			type === positron.RuntimeClientType.Lsp) {
			// Currently the only supported client type
			this._kernel.log(`Creating '${type}' client for ${this.metadata.languageName}`);

			// Create a new client adapter to wrap the comm channel
			const adapter = new RuntimeClientAdapter(id, type, params, this._kernel);

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
			await adapter.open();
		} else {
			this._kernel.log(`Info: can't create ${type} client for ${this.metadata.languageName} (not supported)`);
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
			this._kernel.log(`Removing "${comm.getClientType()}" client ${comm.getClientId()} for ${this.metadata.languageName}`);
			comm.dispose();
		} else {
			// This is a client created on the back end, so we just need to send a
			// comm_close message
			this._kernel.log(`Closing client ${id} for ${this.metadata.languageName}`);
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

		// Check to see whether the payload has a 'status' field that's set to
		// 'error'. If so, the message is an error result message; we'll send an
		// error message to the client.
		//
		// @ts-ignore-next-line
		if (message.status && message.status === 'error') {
			this.onErrorResult(msg, message as JupyterErrorReply);
			return;
		}

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
			case 'execute_result':
				this.onExecuteResult(msg, message as JupyterExecuteResult);
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
			case 'client_event':
				this.onPositronEvent(msg, message as PositronEvent);
				break;
			case 'input_request':
				this.onInputRequest(msg, message as JupyterInputRequest);
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
		} as positron.LanguageRuntimeCommClosed);
	}
	/**
	 * Converts a Positron event into a language runtime event and emits it.
	 *
	 * @param message The message packet
	 * @param event The event
	 */
	onPositronEvent(message: JupyterMessagePacket, event: PositronEvent) {
		this._messages.fire({
			id: message.msgId,
			parent_id: message.originId,
			when: message.when,
			type: positron.LanguageRuntimeMessageType.Event,
			name: event.name,
			data: event.data
		} as positron.LanguageRuntimeEvent);
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
			traceback: data.traceback
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
			type: positron.LanguageRuntimeMessageType.Output,
			data: data.data as any
		} as positron.LanguageRuntimeOutput);
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
			text: data.text
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
			code: data.code
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
			state: data.execution_state
		} as positron.LanguageRuntimeState);

		// Map the kernel status to a runtime status by summarizing the
		// busy/idle messages into a global busy/idle state.
		switch (data.execution_state) {
			case 'idle':
				// Busy/idle messages come in pairs with matching origin IDs. If
				// we get an idle message, remove it from the stack of busy
				// messages by matching it with its origin ID. If the stack is
				// empty, emit an idle event.
				//
				// In most cases, the stack will only have one item; we keep
				// track of the stack to defend against out-of-order messages.
				if (this._busyMessageIds.has(message.originId)) {
					this._busyMessageIds.delete(message.originId);
					if (this._busyMessageIds.size === 0) {
						this.onStatus(positron.RuntimeState.Idle);
					}
				} else {
					// We got an idle message without a matching busy message.
					// This indicates an ordering problem, but we can recover by
					// adding it to the stack of idle messages.
					this._idleMessageIds.add(message.originId);
				}
				break;
			case 'busy':
				// First, check to see if this is the other half of an
				// out-of-order message pair. If we already got the idle side of
				// this message, we can discard it.
				if (this._idleMessageIds.has(message.originId)) {
					this._idleMessageIds.delete(message.originId);
					break;
				}

				// Add this to the stack of busy messages
				this._busyMessageIds.add(message.originId);

				// If it's the first busy message, emit a busy event
				if (this._busyMessageIds.size === 1) {
					this.onStatus(positron.RuntimeState.Busy);
				}
				break;
		}
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

		if (status === positron.RuntimeState.Restarting) {
			this._restarting = true;
		}

		// If the kernel was restarting and successfully exited, this is our
		// cue to start it again.
		if (this._restarting && status === positron.RuntimeState.Exited) {
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
	startPositronLsp(clientAddress: string) {
		// TODO: Should we query the kernel to see if it can create an LSP
		// (QueryInterface style) instead of just demanding it?
		//
		// The Jupyter kernel spec does not provide a way to query for
		// supported comms; the only way to know is to try to create one.

		// Create a unique client ID for this instance
		const uniqueId = Math.floor(Math.random() * 0x100000000).toString(16);
		const clientId = `positron-lsp-${this.metadata.languageId}-${LanguageRuntimeAdapter._clientCounter++}-${uniqueId}}`;
		this._kernel.log(`Starting LSP server ${clientId} for ${clientAddress}`);

		this.createClient(clientId,
			positron.RuntimeClientType.Lsp,
			{ client_address: clientAddress });
	}

	/**
	 * Dispose of the runtime.
	 */
	public dispose() {
		// Turn off all listeners
		this._kernel.removeListener('message', this.onMessage);
		this._kernel.removeListener('status', this.onStatus);

		// Tear down all open comms
		for (const comm of this._comms.values()) {
			comm.dispose();
		}

		// Tell the kernel to shut down
		this._kernel.dispose();
	}
}
