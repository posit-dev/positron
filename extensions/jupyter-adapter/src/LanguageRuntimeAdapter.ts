/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
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

/**
 * LangaugeRuntimeAdapter wraps a JupyterKernel in a LanguageRuntime compatible interface.
 */
export class LanguageRuntimeAdapter
	implements vscode.Disposable, vscode.LanguageRuntime {

	private readonly _kernel: JupyterKernel;
	private readonly _messages: vscode.EventEmitter<vscode.LanguageRuntimeMessage>;
	private readonly _state: vscode.EventEmitter<vscode.RuntimeState>;
	private _lspPort: number | null = null;
	readonly metadata: vscode.LanguageRuntimeMetadata;

	constructor(private readonly _spec: JupyterKernelSpec,
		private readonly _lsp: () => Promise<number> | null,
		private readonly _channel: vscode.OutputChannel) {
		this._kernel = new JupyterKernel(this._spec, this._channel);

		// Generate kernel metadata and ID
		this.metadata = {
			language: this._spec.language,
			name: this._spec.display_name,
			version: '0.0.1',
			id: uuidv4(),
		};
		this._channel.appendLine('Registered kernel: ' + JSON.stringify(this.metadata));

		// No LSP port has been emitted yet
		this._lspPort = null;

		// Create emitter for LanguageRuntime messages and state changes
		this._messages = new vscode.EventEmitter<vscode.LanguageRuntimeMessage>();
		this._state = new vscode.EventEmitter<vscode.RuntimeState>();
		this.onDidReceiveRuntimeMessage = this._messages.event;
		this.onDidChangeRuntimeState = this._state.event;

		// Bind to message stream from kernel
		this.onMessage = this.onMessage.bind(this);
		this._kernel.addListener('message', this.onMessage);

		// Bind to status stream from kernel
		this.onStatus = this.onStatus.bind(this);
		this._kernel.addListener('status', this.onStatus);
	}

	onDidReceiveRuntimeMessage: vscode.Event<vscode.LanguageRuntimeMessage>;
	onDidChangeRuntimeState: vscode.Event<vscode.RuntimeState>;

	/**
	 * Executes a fragment of code in the kernel.
	 *
	 * @param code The code to execute.
	 * @param mode The execution mode.
	 * @param errorBehavior The error behavior.
	 */
	public execute(code: string,
		mode: vscode.RuntimeCodeExecutionMode,
		errorBehavior: vscode.RuntimeErrorBehavior): Thenable<string> {

		this._channel.appendLine(`Sending code to ${this.metadata.language}: ${code}`);

		// Forward execution request to the kernel
		return this._kernel.execute(code, mode, errorBehavior);
	}

	/**
	 * Interrupts the kernel.
	 */
	public interrupt(): void {
		this._channel.appendLine(`Interrupting ${this.metadata.language}`);
		return this._kernel.interrupt();
	}

	/**
	 * Starts a new instance of the language runtime.
	 *
	 * @returns A promise with information about the newly started runtime.
	 */
	public start(): Thenable<vscode.LanguageRuntimeInfo> {
		this._channel.appendLine(`Starting ${this.metadata.language}...`);

		// Reject if the kernel is already running; only in the Unintialized state
		// can we start the kernel
		if (this._kernel.status() !== vscode.RuntimeState.Uninitialized) {
			this._channel.appendLine(`Not started (already running)`);
			Promise.reject('Kernel is already running');
		}

		return new Promise<vscode.LanguageRuntimeInfo>((resolve, reject) => {
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

	private async startKernel(lspPort: number): Promise<vscode.LanguageRuntimeInfo> {
		await this._kernel.start(lspPort);
		return await this.getKernelInfo();
	}

	private getKernelInfo(): Promise<vscode.LanguageRuntimeInfo> {
		// Send a kernel_info_request to get the kernel info
		this._channel.appendLine(`Sending info request to ${this.metadata.language}`);
		this._kernel.sendInfoRequest();

		return new Promise<vscode.LanguageRuntimeInfo>((resolve, _reject) => {
			// Wait for the kernel_info_reply to come back
			this._kernel.on('message', (msg: JupyterMessagePacket) => {
				if (msg.msgType === 'kernel_info_reply') {
					const message = msg.message as JupyterKernelInfoReply;
					resolve({
						banner: message.banner,
						implementation_version: message.implementation_version,
						language_version: message.language_info.version,
					} as vscode.LanguageRuntimeInfo);
				}
			});
		});
	}

	public restart(): void {
		this._kernel.shutdown(true);
		this._kernel.start(this._lspPort ?? 0);
	}

	public shutdown(): void {
		this._kernel.shutdown(false);
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
			case 'status':
				this.onKernelStatus(msg, message as JupyterKernelStatus);
				break;
		}
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
			type: vscode.LanguageRuntimeMessageType.Output,
			data: data.data as any
		} as vscode.LanguageRuntimeOutput);
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
			type: vscode.LanguageRuntimeMessageType.Error,
			name: data.ename,
			message: data.evalue,
			traceback: data.traceback
		} as vscode.LanguageRuntimeError);
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
			type: vscode.LanguageRuntimeMessageType.Output,
			data: data.data as any
		} as vscode.LanguageRuntimeOutput);
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
			type: vscode.LanguageRuntimeMessageType.Input,
			code: data.code
		} as vscode.LanguageRuntimeInput);
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
			type: vscode.LanguageRuntimeMessageType.State,
			state: data.execution_state
		} as vscode.LanguageRuntimeState);
	}

	/**
	 * Converts a Jupyter status message to a RuntimeState and emits it.
	 *
	 * @param status The new status of the kernel
	 */
	onStatus(status: vscode.RuntimeState) {
		this._channel.appendLine(`Kernel status changed to ${status}`);
		this._state.fire(status);
	}

	public dispose() {
		this.shutdown();
	}
}
