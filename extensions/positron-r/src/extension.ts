/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { registerCommands } from './commands';
import { adaptJupyterKernel } from './kernel';
import { initializeLogging, trace, traceOutputChannel } from './logging';

function activateKernel(context: vscode.ExtensionContext) {

	// First, check to see whether there is an override for the kernel path.
	const arkConfig = vscode.workspace.getConfiguration('positron.r');
	const kernelPath = arkConfig.get<string>('kernel.path');
	if (kernelPath) {
		return adaptJupyterKernel(context, kernelPath);
	}

	// No kernel path specified; try the default (embedded) kernel.
	const path = require('path');
	const fs = require('fs');
	const embeddedKernel = path.join(context.extensionPath, 'dist', 'bin', 'ark');
	if (fs.existsSync(embeddedKernel)) {
		return adaptJupyterKernel(context, embeddedKernel);
	}

	// Still no kernel? Try the source path.
	const devKernel = path.join(context.extensionPath, 'amalthea', 'target', 'debug', 'ark');
	if (fs.existsSync(devKernel)) {
		return adaptJupyterKernel(context, devKernel);
	}

	// We couldn't find a kernel. Let the user know.
	vscode.window.showErrorMessage(`ARK kernel path doesn't exist: ${devKernel}. Run 'cargo build' in the amalthea directory.`);

}

export function activate(context: vscode.ExtensionContext) {

	// Activate the kernel.
	activateKernel(context);

	// Initialize logging tools.
	initializeLogging(context);

	// Register commands.
	registerCommands(context);

}

