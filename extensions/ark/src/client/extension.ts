/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { registerCommands } from './commands';
import { adaptJupyterKernel } from './kernel';
import { initializeLogging, trace, traceOutputChannel } from './logging';

export function activate(context: vscode.ExtensionContext) {

	// Read the ark.kernel.path setting to determine the path to the
	// R kernel executable.
	//
	// TODO: We should enumerate R installations on the system instead of
	// requiring the user to specify the path.
	const arkConfig = vscode.workspace.getConfiguration('ark');
	const kernelPath = arkConfig.get<string>('kernel.path');
	if (kernelPath) {
		// We have a kernel path; create a language runtime for it.
		adaptJupyterKernel(context, kernelPath);
	} else {
		// No kernel path yet; wait for the user to set one.
		console.info('No kernel path specified in ark.kernel.path; not registering R language runtime.');
	}

	// Initialize logging tools.
	initializeLogging(context);

	// Register commands.
	registerCommands(context);
}

