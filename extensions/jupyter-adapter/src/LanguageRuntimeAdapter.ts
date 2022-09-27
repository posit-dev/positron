/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { JupyterKernel } from './JupyterKernel';
import { JupyterKernelSpec } from './JupyterKernelSpec';

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
		this.messages = new vscode.EventEmitter<vscode.LanguageRuntimeMessage>();
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

	dispose() {
		this.shutdown();
	}
}
