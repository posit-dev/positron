/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { JupyterKernelSpec } from './JupyterKernelSpec';
import { LanguageRuntimeAdapter } from './LanguageRuntimeAdapter';

export class Api implements vscode.Disposable {
	constructor(private readonly _channel: vscode.OutputChannel) {
	}

	/**
	 * Create an adapter for a Jupyter-compatible kernel.
	 *
	 * @param kernel A Jupyter kernel spec containing the information needed to start the kernel.
	 * @param lsp An optional function that returns a client port number for the LSP server to connect to.
	 * @returns A LanguageRuntimeAdapter that wraps the kernel.
	 */
	adaptKernel(kernel: JupyterKernelSpec, lsp: () => Promise<number> | null): positron.LanguageRuntime {
		return new LanguageRuntimeAdapter(kernel, lsp, this._channel);
	}

	dispose() {
	}
}
