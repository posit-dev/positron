/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export async function registerCommands(context: vscode.ExtensionContext) {
	context.subscriptions.push(

		vscode.commands.registerCommand('zed.quartoVisualMode', () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}
			vscode.commands.executeCommand('positron.reopenWith', editor.document.uri, 'quarto.visualEditor');
		}),

	);
}
