/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import * as positron from 'positron';
import { JavaScriptLanguageRuntime } from './runtime';

/**
 * Registers the extension's commands.
 *
 * @param context The extension context.
 */
export async function registerCommands(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('javascript.startExtHostRuntime', () => {
			startExtHostRuntime(context);
		}));
}

// Singleton instance of the JavaScript language runtime
let _runtime: positron.LanguageRuntime | undefined;

function startExtHostRuntime(context: vscode.ExtensionContext): void {
	if (_runtime) {
		// If the runtime has already been created, just start it
		_runtime.start();
	} else {
		// Otherwise, try to create it
		try {
			_runtime = new JavaScriptLanguageRuntime(context);
			context.subscriptions.push(
				positron.runtime.registerLanguageRuntime(_runtime));
			// Start the runtime on the next tick
			setTimeout(() => {
				_runtime?.start();
			}, 0);
		} catch (e) {
			console.error(e);
		}
	}
}
