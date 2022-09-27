/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { JupyterKernel, KernelStatus } from './JupyterKernel';
import { JupyterKernelSpec } from './JupyterKernelSpec';
import { JupyterMessagePacket } from './JupyterMessagePacket';
import { JupyterDisplayData } from './JupyterDisplayData';
import { JupyterExecuteResult } from './JupyterExecuteResult';
import { JupyterExecuteInput } from './JupyterExecuteInput';

/**
 * LangaugeRuntimeAdapter wraps a JupyterKernel in a LanguageRuntime compatible interface.
 */
export class LanguageRuntimeAdapter
	implements vscode.Disposable, vscode.LanguageRuntime {

	private readonly _kernel: JupyterKernel;

	constructor(private readonly _spec: JupyterKernelSpec) {
		this._kernel = new JupyterKernel(this._spec);
		this.language = this._spec.language;
		this.name = this._spec.display_name;

		// TODO
		this.version = '';
		this.id = '';

		// Create emitter for LanguageRuntime messages and state changes
		this.messages = new vscode.EventEmitter<vscode.LanguageRuntimeMessage>();
		this.state = new vscode.EventEmitter<vscode.RuntimeState>();

		// Bind to message stream from kernel
		this._kernel.addListener('message', this.onMessage);

		// Bind to status stream from kernel
		this._kernel.addListener('status', this.onStatus);
	}

	id: string;
	language: string;
	name: string;
	version: string;
	messages: vscode.EventEmitter<vscode.LanguageRuntimeMessage>;
	state: vscode.EventEmitter<vscode.RuntimeState>;

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

		// Forward execution request to the kernel
		return this._kernel.execute(code, mode, errorBehavior);
	}

	interrupt(): void {
		throw new Error('Method not implemented.');
	}

	restart(): void {
		this._kernel.shutdown(true);
		this._kernel.start();
	}

	shutdown(): void {
		this._kernel.shutdown(false);
	}

	onMessage(msg: JupyterMessagePacket) {
		const message = msg.message;
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
		this.messages.fire({
			id: message.msgId,
			parent_id: message.originId,
			type: vscode.LanguageRuntimeMessageType.Output,
			data: data.data as any
		} as vscode.LanguageRuntimeOutput);
	}

	/**
	 * Converts a Jupyter execute_result message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The execute_result message
	 */
	onExecuteResult(message: JupyterMessagePacket, data: JupyterExecuteResult) {
		this.messages.fire({
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
		this.messages.fire({
			id: message.msgId,
			parent_id: message.originId,
			type: vscode.LanguageRuntimeMessageType.Input,
			code: data.code
		} as vscode.LanguageRuntimeInput);
	}

	/**
	 * Converts a Jupyter status message to a RuntimeState and emits it.
	 *
	 * @param status The new status of the kernel
	 */
	onStatus(status: KernelStatus) {
		this.state.fire(status as string as vscode.RuntimeState);
	}

	dispose() {
		this.shutdown();
	}
}
