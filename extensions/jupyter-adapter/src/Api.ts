/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { JupyterKernelSpec } from './JupyterKernelSpec';

export class Api extends vscode.Disposable {
	constructor() {
		super(() => this.dispose());
	}

	adaptKernel(kernel: JupyterKernelSpec): vscode.LanguageRuntime {
	}

	dispose() {
		super.dispose();
	}
}
