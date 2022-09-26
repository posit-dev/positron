/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { JupyterKernelSpec } from './JupyterKernelSpec';

export class Api implements vscode.Disposable {
	constructor() {
	}

	adaptKernel(_kernel: JupyterKernelSpec): vscode.LanguageRuntime | null {
		return null;
	}

	dispose() {
	}
}
