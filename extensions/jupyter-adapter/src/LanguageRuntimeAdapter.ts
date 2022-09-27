/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { JupyterKernel } from './JupyterKernel';
import { JupyterKernelSpec } from './JupyterKernelSpec';
import { JupyterMessagePacket } from './JupyterMessagePacket';
import { JupyterDisplayData } from './JupyterDisplayData';

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

		// Create emitter for LanguageRuntime messages
		this.messages = new vscode.EventEmitter<vscode.LanguageRuntimeMessage>();

		// Bind to message stream from kernel
		this._kernel.addListener('message', this.onMessage);
	}

	id: string;
	language: string;
	name: string;
	version: string;
	messages: vscode.EventEmitter<vscode.LanguageRuntimeMessage>;
	execute(_code: string): Thenable<string> {
		throw new Error('Method not implemented.');
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

	dispose() {
		this.shutdown();
	}
}
