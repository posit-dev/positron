/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { normalizeUri } from './utils';
import { toDisposable } from './utils-disposables';

/**
 * Closes all open editors in the current VS Code window.
 */
export async function closeAllEditors(): Promise<void> {
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}


/**
 * Open a text document and return it along with a disposable that closes all
 * editors showing it. Useful for ensuring the document is properly cleaned up
 * in tests.
 */
export async function openTextDocument(
	uri: vscode.Uri
): Promise<[vscode.TextDocument, vscode.Disposable]> {
	const doc = await vscode.workspace.openTextDocument(uri);

	const disposable = toDisposable(async () => {
		const expected = normalizeUri(uri);
		const editors = vscode.window.visibleTextEditors.filter(ed => normalizeUri(ed.document.uri) === expected);

		for (const ed of editors) {
			await vscode.window.showTextDocument(ed.document, ed.viewColumn, false);
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		}
	});

	return [doc, disposable];
}
