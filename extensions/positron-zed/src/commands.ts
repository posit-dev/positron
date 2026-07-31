/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

export async function registerCommands(context: vscode.ExtensionContext) {
	context.subscriptions.push(

		vscode.commands.registerCommand('zed.quartoVisualMode', () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}
			vscode.commands.executeCommand('positron.reopenWith', editor.document.uri, 'quarto.visualEditor');
		}),

		// Demo/test the positron.runtime console-history API without needing Posit
		// Assistant: reads the foreground session's recent console history and
		// opens it in a JSON editor so the result is front and center.
		vscode.commands.registerCommand('zed.getConsoleHistory', async () => {
			const session = await positron.runtime.getForegroundSession();
			if (!session) {
				vscode.window.showWarningMessage('Zed: No foreground console session to read history from. Start a console first.');
				return;
			}

			// Let the tester exercise the numberOfEntries argument; blank uses the
			// API default.
			const input = await vscode.window.showInputBox({
				title: 'Get Console History',
				prompt: 'Number of most recent console entries to fetch (leave blank for the default)',
				validateInput: value => (value === '' || /^\d+$/.test(value) ? undefined : 'Enter a positive whole number, or leave blank for the default.'),
			});
			if (input === undefined) {
				return; // Cancelled.
			}
			const numberOfEntries = input === '' ? undefined : Number(input);

			const sessionId = session.metadata.sessionId;
			const entries = await positron.runtime.getConsoleHistory(sessionId, numberOfEntries);

			// Open the result in an untitled JSON editor: more visible than an
			// output channel, and syntax-highlighted for the structured entries.
			const document = await vscode.workspace.openTextDocument({
				language: 'json',
				content: JSON.stringify({ sessionId, numberOfEntries: numberOfEntries ?? null, entryCount: entries.length, entries }, null, 2),
			});
			await vscode.window.showTextDocument(document, { preview: false });
		}),

	);
}
