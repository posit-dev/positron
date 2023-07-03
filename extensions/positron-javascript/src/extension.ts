/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { JavascriptLanguageRuntime } from './runtime';

/**
 * Activates the extension.
 *
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Register the Positron Zed language runtimes. We prefer V2 over V1, so register it first.
	context.subscriptions.push(
		positron.runtime.registerLanguageRuntime(
			new JavascriptLanguageRuntime(context)));
}
