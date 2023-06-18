/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { registerCommands } from './commands';
import { adaptJupyterKernel } from './kernel';
import { initializeLogging, trace, traceOutputChannel } from './logging';
import { providePackageTasks } from './tasks';

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

	// Still no kernel? Look for locally built Debug or Release kernels.
	// If both exist, we'll use whichever is newest.
	let devKernel = undefined;
	const devDebugKernel = path.join(context.extensionPath, 'amalthea', 'target', 'debug', 'ark');
	const devReleaseKernel = path.join(context.extensionPath, 'amalthea', 'target', 'release', 'ark');
	const debugModified = fs.statSync(devDebugKernel, { throwIfNoEntry: false })?.mtime;
	const releaseModified = fs.statSync(devReleaseKernel, { throwIfNoEntry: false })?.mtime;

	if (debugModified) {
		devKernel = (releaseModified && releaseModified > debugModified) ? devReleaseKernel : devDebugKernel;
	} else if (releaseModified) {
		devKernel = devReleaseKernel;
	}

	if (devKernel) {
		return adaptJupyterKernel(context, devKernel);
	}

	// We couldn't find a kernel. Let the user know.
	vscode.window.showErrorMessage(`ARK kernel path doesn't exist: ${devReleaseKernel}. Run 'cargo build' in the amalthea directory.`);

}

export function activate(context: vscode.ExtensionContext) {

	// Activate the kernel.
	activateKernel(context);

	// Initialize logging tools.
	initializeLogging(context);

	// Register commands.
	registerCommands(context);

	// Provide tasks.
	providePackageTasks(context);

}

