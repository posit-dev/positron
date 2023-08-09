/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { registerCommands } from './commands';
import { initializeLogging, trace, traceOutputChannel } from './logging';
import { rRuntimeProvider } from './provider';


export function activate(context: vscode.ExtensionContext) {

	positron.runtime.registerLanguageRuntimeProvider(
		'r', rRuntimeProvider(context));

	// Initialize logging tools.
	initializeLogging(context);

	// Register commands.
	registerCommands(context);

}

