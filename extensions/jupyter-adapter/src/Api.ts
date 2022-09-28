/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { JupyterKernelSpec } from './JupyterKernelSpec';
import { LanguageRuntimeAdapter } from './LanguageRuntimeAdapter';

export class Api implements vscode.Disposable {
	constructor() {
	}

	/**
	 * Create an adapter for a Jupyter-compatible kernel.
	 *
	 * @param kernel A Jupyter kernel spec containing the information needed to start the kernel.
	 * @param integratedLsp  Whether the kernel is using an integrated language server.
	 * @returns A LanguageRuntimeAdapter that wraps the kernel.
	 */
	adaptKernel(kernel: JupyterKernelSpec, integratedLsp: boolean): vscode.LanguageRuntime {
		return new LanguageRuntimeAdapter(kernel, integratedLsp);
	}

	dispose() {
	}
}
