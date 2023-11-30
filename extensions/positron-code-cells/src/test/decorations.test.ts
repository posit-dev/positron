/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { closeAllEditors, delay, disposeAll } from './utils';
import { SetDecorations, activateDecorations, cellDecorationType } from '../decorations';

suite('Decorations', () => {
	const disposables: vscode.Disposable[] = [];
	const decorations: Map<vscode.TextEditorDecorationType, vscode.Range[]> = new Map();
	const setDecorations: SetDecorations = (_editor, decorationType, ranges) => {
		decorations.set(decorationType, ranges);
	};
	setup(() => {
		// Activate decorations with a custom setDecorations that stores the decorated ranges.
		activateDecorations(disposables, setDecorations);
	});
	teardown(async () => {
		disposeAll(disposables);
		await closeAllEditors();
	});

	function assertCellDecorationRangesEqual(expected: vscode.Range[]): void {
		assert.deepStrictEqual(decorations.get(cellDecorationType), expected, 'Cell decoration ranges are not equal');
	}

	test('Opening an empty Python document', async () => {
		await showTextDocument();
		assertCellDecorationRangesEqual([]);
	});

	test('Opening a Python document with code cells', async () => {
		await showTextDocument('#%%');
		assertCellDecorationRangesEqual([new vscode.Range(0, 0, 0, 3)]);
	});

	test('Adding a code cell to an empty Python document', async () => {
		const editor = await showTextDocument();
		assertCellDecorationRangesEqual([]);

		const result = await editor.edit((editBuilder) => {
			editBuilder.insert(new vscode.Position(0, 0), '#%%');
		});
		assert.ok(result);
		assertCellDecorationRangesEqual([new vscode.Range(0, 0, 0, 3)]);
	});

	test('Changing the selected code cell in a Python document', async () => {
		const editor = await showTextDocument('#%%\n#%%');
		editor.selection = new vscode.Selection(1, 0, 1, 0);
		assertCellDecorationRangesEqual([new vscode.Range(0, 0, 0, 3)]);

		// Move the selection to the second cell
		editor.selection = new vscode.Selection(1, 0, 1, 0);

		// Decorations do not update immediately
		assertCellDecorationRangesEqual([new vscode.Range(0, 0, 0, 3)]);

		// Decorations update after a delay
		await delay(260);
		assertCellDecorationRangesEqual([new vscode.Range(1, 0, 1, 3)]);
	});

	test('Removing all code cells from a Python document', async () => {
		const editor = await showTextDocument('#%%');
		assertCellDecorationRangesEqual([new vscode.Range(0, 0, 0, 3)]);

		await editor.edit((editBuilder) => {
			editBuilder.delete(new vscode.Range(0, 0, 1, 0));
		});

		// Decorations do not update immediately
		assertCellDecorationRangesEqual([new vscode.Range(0, 0, 0, 3)]);

		// Decorations update after a delay
		await delay(260);
		assertCellDecorationRangesEqual([]);
	});

	test('Changing the active editor', async () => {
		await showTextDocument('#%%');
		assertCellDecorationRangesEqual([new vscode.Range(0, 0, 0, 3)]);

		await showTextDocument('');
		assertCellDecorationRangesEqual([]);
	});
});

async function showTextDocument(content?: string): Promise<vscode.TextEditor> {
	const document = await vscode.workspace.openTextDocument({ language: 'python', content });
	return await vscode.window.showTextDocument(document);
}
