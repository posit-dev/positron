/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { JupyterKernelSpec } from './JupyterKernelSpec';
import { LanguageRuntimeAdapter } from './LanguageRuntimeAdapter';

export class Api implements vscode.Disposable {
	constructor() {
	}

	adaptKernel(kernel: JupyterKernelSpec): vscode.LanguageRuntime {
		return new LanguageRuntimeAdapter(kernel);
	}

	dispose() {
	}
}
