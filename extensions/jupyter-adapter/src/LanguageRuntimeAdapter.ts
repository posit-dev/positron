/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { v4 as uuidv4 } from 'uuid';
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

/**
 * LangaugeRuntimeAdapter wraps a JupyterKernel in a LanguageRuntime compatible interface.
 */
export class LanguageRuntimeAdapter
	implements vscode.Disposable, positron.LanguageRuntime {

	private readonly _kernel: JupyterKernel;
	private readonly _messages: vscode.EventEmitter<positron.LanguageRuntimeMessage>;
	private readonly _state: vscode.EventEmitter<positron.RuntimeState>;
	private _kernelState: positron.RuntimeState = positron.RuntimeState.Uninitialized;
	private _lspPort: number | null = null;
	readonly metadata: positron.LanguageRuntimeMetadata;

	/**
	 * Map of comm IDs to RuntimeClientAdapters, which wrap comm channels.
	 *
	 * Consider: This will need to be rethought if we want to support
	 * reattaching to a running kernel. In that case, this map will need
	 * to get populated by asking the kernel, after connecting, for the
	 * list of comms that are currently open.
	 */
	private readonly _comms: Map<string, RuntimeClientAdapter> = new Map();

	constructor(private readonly _spec: JupyterKernelSpec,
		version: string,
		private readonly _lsp: () => Promise<number> | null,
		private readonly _channel: vscode.OutputChannel) {
		this._kernel = new JupyterKernel(this._spec, this._channel);

		// Generate kernel metadata and ID
		this.metadata = {
			language: this._spec.language,
			name: this._spec.display_name,
			version: version,
			id: uuidv4(),
		};
		this._channel.appendLine('Registered kernel: ' + JSON.stringify(this.metadata));

		// No LSP port has been emitted yet
		this._lspPort = null;

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

		this._channel.appendLine(`Sending code to ${this.metadata.language}: ${code}`);

		// Forward execution request to the kernel
		this._kernel.execute(code, id, mode, errorBehavior);
	}

	public isCodeFragmentComplete(code: string): Thenable<positron.RuntimeCodeFragmentStatus> {
		this._kernel.testCodeFragment(code);
	}

	/**
	 * Replies to an input prompt from the kernel.
	 *
	 * @param id The ID of the prompt to which user responded
	 * @param reply The user's response
	 */
	public replyToPrompt(id: string, reply: string): void {
		this._channel.appendLine(`Sending reply to prompt ${id}: ${reply}`);
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

		this._channel.appendLine(`Interrupting ${this.metadata.language}`);
		return this._kernel.interrupt();
	}

	/**
	 * Starts a new instance of the language runtime.
	 *
	 * @returns A promise with information about the newly started runtime.
	 */
	public start(): Thenable<positron.LanguageRuntimeInfo> {
		this._channel.appendLine(`Starting ${this.metadata.language}...`);

		// Reject if the kernel is already running; only in the Unintialized state
		// can we start the kernel
		if (this._kernel.status() !== positron.RuntimeState.Uninitialized) {
			this._channel.appendLine(`Not started (already running or starting up)`);
			Promise.reject('Kernel is already started or running');
		}

		// Update the kernel's state to Initializing
		this.onStatus(positron.RuntimeState.Initializing);

		return new Promise<positron.LanguageRuntimeInfo>((resolve, reject) => {
			if (this._lsp) {
				// If we have an LSP, start it, then start the kernel
				this._lsp()!.then((port) => {
					// Save the LSP port for use on restarts
					this._lspPort = port;
					return this.startKernel(port);
				}).then((info) => {
					resolve(info);
				}).catch((err) => {
					reject(err);
				});
			} else {
				// Otherwise, just start the kernel
				this.startKernel(0).then(info => {
					resolve(info);
				});
			}
		});
	}

	private async startKernel(lspPort: number): Promise<positron.LanguageRuntimeInfo> {
		await this._kernel.start(lspPort);
		return await this.getKernelInfo();
	}

	private getKernelInfo(): Promise<positron.LanguageRuntimeInfo> {
		// Send a kernel_info_request to get the kernel info
		this._channel.appendLine(`Sending info request to ${this.metadata.language}`);
		this._kernel.sendInfoRequest();

		return new Promise<positron.LanguageRuntimeInfo>((resolve, _reject) => {
			// Wait for the kernel_info_reply to come back
			this._kernel.on('message', (msg: JupyterMessagePacket) => {
				if (msg.msgType === 'kernel_info_reply') {
					const message = msg.message as JupyterKernelInfoReply;
					resolve({
						banner: message.banner,
						implementation_version: message.implementation_version,
						language_version: message.language_info.version,
					} as positron.LanguageRuntimeInfo);
				}
			});
		});
	}

	/**
	 * Restarts the kernel.
	 */
	public restart(): void {
		this._kernel.shutdown(true);
		this._kernel.start(this._lspPort ?? 0);
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
	 * @returns A new client instance, or empty string if the type is not supported
	 */
	public createClient(type: positron.RuntimeClientType): string {
		if (type === positron.RuntimeClientType.Environment) {
			// Currently the only supported client type
			this._channel.appendLine(`Creating ${type} client for ${this.metadata.language}`);

			// Create a new client adapter to wrap the comm channel
			const adapter = new RuntimeClientAdapter(type, this._kernel);

			// Ensure we clean up the client from our internal state when it disconnects
			adapter.onDidChangeClientState((e) => {
				if (e === positron.RuntimeClientState.Closed) {
					if (!this._comms.delete(adapter.getId())) {
						this._channel.appendLine(`Warn: Runtime client adapater ${adapter.getId()} (${adapter.getClientType()}) not found`);
					}
				}
			});

			// Add the client to the map
			this._comms.set(adapter.getId(), adapter);

			// Return the ID of the new client
			return adapter.getId();
		} else {
			this._channel.appendLine(`Info: can't create ${type} client for ${this.metadata.language} (not supported)`);
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
			this._channel.appendLine(`Removing "${comm.getClientType()}" client ${comm.getClientId()} for ${this.metadata.language}`);
			comm.dispose();
		} else {
			this._channel.appendLine(`Error: can't remove client ${id} (not found)`);
		}
	}

	sendClientMessage(id: string, message: any): void {
		this._kernel.sendCommMessage(id, message);
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
			type: positron.LanguageRuntimeMessageType.Prompt,
			prompt: req.prompt,
			password: req.password,
		} as positron.LanguageRuntimePrompt);
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
			type: positron.LanguageRuntimeMessageType.Output,
			data: data.data as any
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
			type: positron.LanguageRuntimeMessageType.State,
			state: data.execution_state
		} as positron.LanguageRuntimeState);
	}

	/**
	 * Converts a Jupyter status message to a RuntimeState and emits it.
	 *
	 * @param status The new status of the kernel
	 */
	onStatus(status: positron.RuntimeState) {
		this._channel.appendLine(`Kernel status changed to ${status}`);
		this._kernelState = status;
		this._state.fire(status);
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
		this.shutdown();
	}
}
