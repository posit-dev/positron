/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronZedLanguageRuntime } from './positronZedLanguageRuntime';

/**
 * Activates the extension.
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Register the Positron Zed language runtimes. We prefer V2 over V1, so register it first.
	context.subscriptions.push(positron.runtime.registerLanguageRuntime(new PositronZedLanguageRuntime(
		'00000000-0000-0000-0000-000000000200', '2.0.0'
	)));
	context.subscriptions.push(positron.runtime.registerLanguageRuntime(new PositronZedLanguageRuntime(
		'00000000-0000-0000-0000-000000000100', '1.0.0'
	)));
	context.subscriptions.push(positron.runtime.registerLanguageRuntime(new PositronZedLanguageRuntime(
		'00000000-0000-0000-0000-000000000098', '0.98.0'
	)));
}
