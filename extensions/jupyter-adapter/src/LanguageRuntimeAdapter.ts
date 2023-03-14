/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as crypto from 'crypto';
import { JupyterKernel } from './JupyterKernel';
import { JupyterKernelSpec } from './JupyterKernelSpec';
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
import { findAvailablePort } from './PortFinder';
import { JupyterCommMsg } from './JupyterCommMsg';
import { JupyterCommClose } from './JupyterCommClose';

/**
 * LangaugeRuntimeAdapter wraps a JupyterKernel in a LanguageRuntime compatible interface.
 */
export class LanguageRuntimeAdapter
	implements vscode.Disposable, positron.LanguageRuntime {

	private readonly _kernel: JupyterKernel;
	private readonly _messages: vscode.EventEmitter<positron.LanguageRuntimeMessage>;
	private readonly _state: vscode.EventEmitter<positron.RuntimeState>;
	private _kernelState: positron.RuntimeState = positron.RuntimeState.Uninitialized;
	readonly metadata: positron.LanguageRuntimeMetadata;

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

	constructor(private readonly _context: vscode.ExtensionContext,
		private readonly _spec: JupyterKernelSpec,
		languageId: string,
		languageVersion: string,
		runtimeVersion: string,
		private readonly _channel: vscode.OutputChannel,
		startupBehavior: positron.LanguageRuntimeStartupBehavior = positron.LanguageRuntimeStartupBehavior.Implicit,
		private readonly _lsp?: (port: number) => Promise<void>) {

		// Hash all the metadata together
		const digest = crypto.createHash('sha256');
		digest.update(JSON.stringify(this._spec));
		digest.update(languageId);
		digest.update(runtimeVersion);
		digest.update(languageVersion);

		// Extract the first 32 characters of the hash as the runtime ID
		const runtimeId = digest.digest('hex').substring(0, 32);

		this._kernel = new JupyterKernel(this._context, this._spec, runtimeId, this._channel);

		// Generate kernel metadata and ID
		this.metadata = {
			runtimeId,
			runtimeName: this._spec.display_name,
			runtimeVersion,
			languageId,
			languageName: this._spec.language,
			languageVersion,
			startupBehavior: startupBehavior
		};
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
	public interrupt(): void {

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
	public restart(): void {
		this._kernel.shutdown(true);
		this._kernel.start();
	}

	/**
	 * Shuts down the kernel permanently.
	 */
	public shutdown(): void {
		this._kernel.shutdown(false);
	}

	/**
	 * Creates a new client instance.
	 *
	 * @param type The type of client to create
	 * @param params The parameters for the client; the format of this object is
	 *   specific to the client type
	 * @returns A new client instance, or empty string if the type is not supported
	 */
	public async createClient(type: positron.RuntimeClientType, params: object): Promise<string> {
		if (type === positron.RuntimeClientType.Environment ||
			type === positron.RuntimeClientType.Lsp) {
			// Currently the only supported client type
			this._kernel.log(`Creating '${type}' client for ${this.metadata.languageName}`);

			// Create a new client adapter to wrap the comm channel
			const adapter = new RuntimeClientAdapter(type, params, this._kernel);

			// Add the client to the map. Note that we have to do this before opening
			// the instance, because we may need to process messages from the client
			// before the open call completes due to message ordering.
			this._comms.set(adapter.getId(), adapter);

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

			// Return the ID of the new client
			return adapter.getId();
		} else {
			this._kernel.log(`Info: can't create ${type} client for ${this.metadata.languageName} (not supported)`);
		}
		return '';
	}

	/**
	 * Removes a client instance.
	 *
	 * @param id The ID of the client to remove
	 */
	removeClient(id: string): void {
		const comm = this._comms.get(id);
		if (comm) {
			this._kernel.log(`Removing "${comm.getClientType()}" client ${comm.getClientId()} for ${this.metadata.languageName}`);
			comm.dispose();
		} else {
			this._kernel.log(`Error: can't remove client ${id} (not found)`);
		}
	}

	sendClientMessage(id: string, message: any): void {
		this._kernel.sendCommMessage(id, message);
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

	/**
	 * Gets a list of all client instances
	 *
	 * @returns All client instances
	 */
	public getClients(): positron.RuntimeClientInstance[] {
		return Array.from(this._comms.values());
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
			type: data.name === 'stderr' ?
				positron.LanguageRuntimeMessageType.Error :
				positron.LanguageRuntimeMessageType.Output,
			data: {
				'text/plain': data.text
			} as any
		} as positron.LanguageRuntimeOutput);
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
		this._kernel.log(`${this._spec.language} kernel status changed to ${status}`);
		this._kernelState = status;
		this._state.fire(status);

		// When the kernel becomes ready, start the LSP server if it's configured
		if (status === positron.RuntimeState.Ready && this._lsp) {
			findAvailablePort([], 25).then(port => {
				this._kernel.log(`Kernel ready, connecting to ${this._spec.display_name} LSP server on port ${port}...`);
				this.startLsp(`127.0.0.1:${port}`);
				this._lsp!(port).then(() => {
					this._kernel.log(`${this._spec.display_name} LSP server connected`);
				});
			});
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
	public startLsp(clientAddress: string) {
		// TODO: Should we query the kernel to see if it can create an LSP
		// (QueryInterface style) instead of just demanding it?
		//
		// The Jupyter kernel spec does not provide a way to query for
		// supported comms; the only way to know is to try to create one.

		this._kernel.log(`Starting LSP server for ${clientAddress}`);
		this.createClient(positron.RuntimeClientType.Lsp, { client_address: clientAddress });
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
