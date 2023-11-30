/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { CellFoldingRangeProvider } from '../folding';
import { closeAllEditors } from './utils';

suite('Folding', () => {
	teardown(closeAllEditors);

	test('Provides Python cell folding ranges', async () => {
		const language = 'python';
		const content = `#%%
testing1
#%%
testing2
#%%
testing3`;
		const document = await vscode.workspace.openTextDocument({ language, content });
		const provider = new CellFoldingRangeProvider();

		const foldingRanges = await provider.provideFoldingRanges(document);

		assert.ok(foldingRanges, 'No folding ranges provided');
		assert.deepStrictEqual(foldingRanges, [
			new vscode.FoldingRange(0, 1),
			new vscode.FoldingRange(2, 3),
			new vscode.FoldingRange(4, 5),
		], 'Incorrect folding ranges');
	});

	test('Provides R cell folding ranges', async () => {
		const language = 'r';
		const content = `#+
testing1
#+
testing2
#+
testing3`;
		const document = await vscode.workspace.openTextDocument({ language, content });
		const provider = new CellFoldingRangeProvider();

		const foldingRanges = await provider.provideFoldingRanges(document);

		assert.ok(foldingRanges, 'No folding ranges provided');
		assert.deepStrictEqual(foldingRanges, [
			new vscode.FoldingRange(0, 1),
			new vscode.FoldingRange(2, 3),
			new vscode.FoldingRange(4, 5),
		], 'Incorrect folding ranges');
	});
});
