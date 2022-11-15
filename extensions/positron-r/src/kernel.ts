/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as fs from 'fs';

import { withActiveExtension } from './util';

import { activateLsp } from './lsp';
import { Disposable } from 'vscode-languageclient';

// A global instance of the language runtime (and LSP language server) provided
// by this language pack
let runtime: positron.LanguageRuntime;

export function adaptJupyterKernel(context: vscode.ExtensionContext, kernelPath: string) {
	// Check to see whether the Jupyter Adapter extension is installed
	// and active. If so, we can start the language server.
	const ext = vscode.extensions.getExtension('vscode.jupyter-adapter');
	if (!ext) {
		vscode.window.showErrorMessage(`Could not find Jupyter Adapter extension; can't register ARK.`);
		return;
	}

	// We have a kernel path; use the VS Code file system API to see if it exists on disk.
	const fs = require('fs');
	if (!fs.existsSync(kernelPath)) {
		vscode.window.showErrorMessage(`ARK kernel path doesn't exist: ${kernelPath}`);
		return;
	}

	withActiveExtension(ext, () => {
		return registerArkKernel(ext!, context, kernelPath as string);
	});
}

export function registerArkKernel(ext: vscode.Extension<any>, context: vscode.ExtensionContext, kernelPath: string): vscode.Disposable {

	const rInstallations: Array<string> = [];

	// Discover R installations.
	// TODO: Needs to handle Linux and Windows

	// Look for the default R installation on macOS
	if (fs.existsSync('/Library/Frameworks/R.framework/Resources')) {
		rInstallations.push('/Library/Frameworks/R.framework/Resources');
	}

	// Look for an R installation on the $PATH (e.g. installed via Homebrew)
	try {
		// Try R RHOME to get the installation path; run under bash so we get $PATH
		// set as the user would expect.
		const { execSync } = require('child_process');
		const rHome = execSync('R RHOME', { shell: '/bin/bash', encoding: 'utf8' }).trim();
		if (fs.existsSync(rHome)) {
			// Add the R installation to the list (if it's not already there)
			if (rInstallations.indexOf(rHome) === -1) {
				rInstallations.push(rHome);
			}
		}
	} catch (err) {
		// Just swallow this; it's okay if there's no R on the $PATH
	}

	// Loop over the R installations and create a language runtime for each one.
	const disposables: vscode.Disposable[] = rInstallations.map(rHome => {
		const kernelSpec = {
			'argv': [kernelPath, '--connection_file', '{connection_file}'],
			'display_name': `R: ${rHome}`, // eslint-disable-line
			'language': 'R',
			'env': {
				'RUST_LOG': 'trace', // eslint-disable-line
				'R_HOME': rHome, // eslint-disable-line
				'DYLD_INSERT_LIBRARIES': `${rHome}/lib/libR.dylib`, // eslint-disable-line
				'RUST_BACKTRACE': '1' // eslint-disable-line
			}
		};

		// Create an adapter for the kernel to fulfill the LanguageRuntime interface.
		runtime = ext.exports.adaptKernel(kernelSpec, () => {
			return activateLsp(context);
		});

		// Register a language runtime provider for the ARK kernel.
		return positron.runtime.registerLanguageRuntime(runtime);
	});

	// Return a disposable that will dispose of all the language runtime providers.
	return Disposable.create(() => {
		disposables.forEach(d => d.dispose());
	});
}

