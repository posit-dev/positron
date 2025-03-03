/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { closeAllEditors, delay, disposeAll } from './utils';
import {
	SetDecorations,
	activateDecorations,
	focusedCellTopDecorationType,
	focusedCellBottomDecorationType,
	unfocusedCellTopDecorationType,
	unfocusedCellBottomDecorationType
} from '../decorations';

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

	function assertFocusedCellDecorationRangesEqual(
		expectedTopRanges: vscode.Range[],
		expectedBottomRanges: vscode.Range[]
	): void {
		assert.deepStrictEqual(
			decorations.get(focusedCellTopDecorationType),
			expectedTopRanges,
			'Focused cell top decoration ranges are not equal'
		);
		assert.deepStrictEqual(
			decorations.get(focusedCellBottomDecorationType),
			expectedBottomRanges,
			'Focused cell bottom decoration ranges are not equal'
		);
	}

	function assertUnfocusedCellDecorationRangesEqual(
		expectedTopRanges: vscode.Range[],
		expectedBottomRanges: vscode.Range[]
	): void {
		assert.deepStrictEqual(
			decorations.get(unfocusedCellTopDecorationType),
			expectedTopRanges,
			'Unfocused cell top decoration ranges are not equal'
		);
		assert.deepStrictEqual(
			decorations.get(unfocusedCellBottomDecorationType),
			expectedBottomRanges,
			'Unfocused cell bottom decoration ranges are not equal'
		);
	}

	test('Opening an empty Python document', async () => {
		await showTextDocument();
		assertFocusedCellDecorationRangesEqual([], []);
		assertUnfocusedCellDecorationRangesEqual([], []);
	});

	test('Opening a Python document with code cells', async () => {
		await showTextDocument('#%%');
		// First line should have both top and bottom decorations since it's a one-line cell
		assertFocusedCellDecorationRangesEqual(
			[new vscode.Range(0, 0, 0, 0)], // Top border on line 0
			[new vscode.Range(0, 0, 0, 0)]  // Bottom border on line 0
		);
		assertUnfocusedCellDecorationRangesEqual([], []);
	});

	test('Adding a code cell to an empty Python document', async () => {
		const editor = await showTextDocument();
		assertFocusedCellDecorationRangesEqual([], []);
		assertUnfocusedCellDecorationRangesEqual([], []);

		const result = await editor.edit((editBuilder) => {
			editBuilder.insert(new vscode.Position(0, 0), '#%%');
		});
		assert.ok(result);
		assertFocusedCellDecorationRangesEqual(
			[new vscode.Range(0, 0, 0, 0)], // Top border on line 0
			[new vscode.Range(0, 0, 0, 0)]  // Bottom border on line 0
		);
		assertUnfocusedCellDecorationRangesEqual([], []);
	});

	test('Changing the selected code cell in a Python document', async () => {
		const editor = await showTextDocument('#%%\n#%%');
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		assertFocusedCellDecorationRangesEqual(
			[new vscode.Range(0, 0, 0, 0)], // Top border on line 0
			[new vscode.Range(0, 0, 0, 0)]  // Bottom border on line 0
		);
		assertUnfocusedCellDecorationRangesEqual(
			[new vscode.Range(1, 0, 1, 0)], // Top border on line 1
			[new vscode.Range(1, 0, 1, 0)]  // Bottom border on line 1
		);

		// Move the selection to the second cell
		editor.selection = new vscode.Selection(1, 0, 1, 0);

		// Decorations update after a delay
		await delay(400);
		assertFocusedCellDecorationRangesEqual(
			[new vscode.Range(1, 0, 1, 0)], // Top border on line 1
			[new vscode.Range(1, 0, 1, 0)]  // Bottom border on line 1
		);
		assertUnfocusedCellDecorationRangesEqual(
			[new vscode.Range(0, 0, 0, 0)], // Top border on line 0
			[new vscode.Range(0, 0, 0, 0)]  // Bottom border on line 0
		);
	});

	test('Removing all code cells from a Python document', async () => {
		const editor = await showTextDocument('#%%');
		assertFocusedCellDecorationRangesEqual(
			[new vscode.Range(0, 0, 0, 0)], // Top border on line 0
			[new vscode.Range(0, 0, 0, 0)]  // Bottom border on line 0
		);

		await editor.edit((editBuilder) => {
			editBuilder.delete(new vscode.Range(0, 0, 1, 0));
		});

		// Decorations update after a delay
		await delay(400);
		assertFocusedCellDecorationRangesEqual([], []);
		assertUnfocusedCellDecorationRangesEqual([], []);
	});

	test('Changing the active editor', async () => {
		await showTextDocument('#%%');
		assertFocusedCellDecorationRangesEqual(
			[new vscode.Range(0, 0, 0, 0)], // Top border on line 0
			[new vscode.Range(0, 0, 0, 0)]  // Bottom border on line 0
		);

		await showTextDocument('');
		assertFocusedCellDecorationRangesEqual([], []);
		assertUnfocusedCellDecorationRangesEqual([], []);
	});

	test('Document with multiple line cells', async () => {
		const editor = await showTextDocument('#%%\nx = 1\ny = 2\n\n#%%\nz = 3');
		editor.selection = new vscode.Selection(1, 0, 1, 0); // Select first cell

		// Wait for decorations to update
		await delay(400);

		// First cell should be focused (lines 0-3)
		assertFocusedCellDecorationRangesEqual(
			[new vscode.Range(0, 0, 0, 0)], // Top border on first line of cell
			[new vscode.Range(3, 0, 3, 0)]  // Bottom border on last line of cell
		);

		// Second cell should be unfocused (lines 4-5)
		assertUnfocusedCellDecorationRangesEqual(
			[new vscode.Range(4, 0, 4, 0)], // Top border on first line of cell
			[new vscode.Range(5, 0, 5, 0)]  // Bottom border on last line of cell
		);

		// Move selection to second cell
		editor.selection = new vscode.Selection(5, 0, 5, 0);

		// Wait for decorations to update
		await delay(400);

		// First cell should now be unfocused
		assertUnfocusedCellDecorationRangesEqual(
			[new vscode.Range(0, 0, 0, 0)], // Top border on first line of cell
			[new vscode.Range(3, 0, 3, 0)]  // Bottom border on last line of cell
		);

		// Second cell should now be focused
		assertFocusedCellDecorationRangesEqual(
			[new vscode.Range(4, 0, 4, 0)], // Top border on first line of cell
			[new vscode.Range(5, 0, 5, 0)]  // Bottom border on last line of cell
		);
	});
});

async function showTextDocument(content?: string): Promise<vscode.TextEditor> {
	const document = await vscode.workspace.openTextDocument({ language: 'python', content });
	const editor = await vscode.window.showTextDocument(document);
	return editor;
}
