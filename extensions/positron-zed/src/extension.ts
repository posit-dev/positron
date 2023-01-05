/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
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
		'0a856053-7744-4ac0-a273-4b74b25dc445', '2.0.0'
	)));
	context.subscriptions.push(positron.runtime.registerLanguageRuntime(new PositronZedLanguageRuntime(
		'685c6301-b214-42be-be78-8fa4ae044cf4', '1.0.0'
	)));
}
