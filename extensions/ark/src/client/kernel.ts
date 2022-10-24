/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { withActiveExtension } from './util';

import { activateLsp } from './lsp';

// A global instance of the language runtime (and LSP language server) provided
// by this language pack
let runtime: vscode.LanguageRuntime;

export function adaptJupyterKernel(context: vscode.ExtensionContext, kernelPath: string) {
	// Check to see whether the Jupyter Adapter extension is installed
	// and active. If so, we can start the language server.
	const ext = vscode.extensions.getExtension('posit.jupyter-adapter');
	if (!ext) {
		vscode.window.showErrorMessage(`Could not find Jupyter Adapter extension; can't register ARK.`);
		return;
	}

	// We have a kernel path; use the VS Code file system API to see if it exists on disk.
	const fs = require('fs');
	if (!fs.existsSync(kernelPath)) {
		vscode.window.showErrorMessage(`ARK kernel path specified in 'ark.kernel.path' setting does not exist: ${kernelPath}`);
		return;
	}

	withActiveExtension(ext, () => {
		return registerArkKernel(ext!, context, kernelPath as string);
	});
}

export function registerArkKernel(ext: vscode.Extension<any>, context: vscode.ExtensionContext, kernelPath: string): vscode.Disposable {

	const kernelSpec = {
		'argv': [kernelPath, '--connection_file', '{connection_file}'],
		'display_name': 'Amalthea R Kernel (ARK)', // eslint-disable-line
		'language': 'R',
		'env': {
			'RUST_LOG': 'trace', // eslint-disable-line
			'R_HOME': '/Library/Frameworks/R.framework/Resources', // eslint-disable-line
			'RUST_BACKTRACE': '1' // eslint-disable-line
		}
	};

	// Create an adapter for the kernel to fulfill the LanguageRuntime interface.
	runtime = ext.exports.adaptKernel(kernelSpec, () => {
		return activateLsp(context);
	});

	// Register a language runtime provider for the ARK kernel.
	return vscode.positron.registerLanguageRuntime(runtime);
}

