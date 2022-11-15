/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import path = require('path');
import * as vscode from 'vscode';

import { registerCommands } from './commands';
import { adaptJupyterKernel } from './kernel';
import { initializeLogging, trace, traceOutputChannel } from './logging';

export function activate(context: vscode.ExtensionContext) {

	// First, check to see whether there is an override for the kernel path.
	const arkConfig = vscode.workspace.getConfiguration('positron.r');
	const kernelPath = arkConfig.get<string>('kernel.path');
	if (kernelPath) {
		// We have a kernel path; create a language runtime for it.
		adaptJupyterKernel(context, kernelPath);
	} else {
		// No kernel path specified; try the default (embedded) kernel.
		const embeddedKernel = path.join(context.extensionPath, 'dist', 'bin', 'ark');
		const fs = require('fs');
		if (fs.existsSync(embeddedKernel)) {
			adaptJupyterKernel(context, embeddedKernel);
		} else {
			// Still no kernel? Try the source path.
			const devKernel = path.join(context.extensionPath, 'amalthea', 'target', 'debug', 'ark');
			if (fs.existsSync(devKernel)) {
				adaptJupyterKernel(context, devKernel);
			} else {
				vscode.window.showErrorMessage(`ARK kernel path doesn't exist: ${devKernel}. Run 'cargo build' in the amalthea directory.`);
			}
		}
	}

	// Initialize logging tools.
	initializeLogging(context);

	// Register commands.
	registerCommands(context);
}

