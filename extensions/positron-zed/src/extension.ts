/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronZedLanguageRuntime } from './positronZedLanguageRuntime';

/**
 * Activates the extension.
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Register the Positron Zed language runtime.
	context.subscriptions.push(positron.runtime.registerLanguageRuntime(new PositronZedLanguageRuntime()));
}
