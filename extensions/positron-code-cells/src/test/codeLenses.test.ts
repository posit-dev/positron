/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { CellCodeLensProvider, runAboveCodeLens, runCellCodeLens, runNextCodeLens } from '../codeLenses';
import { closeAllEditors } from './utils';

suite('CodeLenses', () => {
	teardown(closeAllEditors);

	test('Provides Python cell code lenses', async () => {
		const language = 'python';
		const content = `#%%
testing1
#%%
testing2
#%%
testing3`;
		const document = await vscode.workspace.openTextDocument({ language, content });
		const provider = new CellCodeLensProvider();

		const codeLenses = await provider.provideCodeLenses(document);

		assert.ok(codeLenses, 'No code lenses provided');
		verifyCodeLenses(codeLenses, [
			new vscode.Range(0, 0, 1, 8),
			new vscode.Range(2, 0, 3, 8),
			new vscode.Range(4, 0, 5, 8)
		]);
	});

	test('Provides R cell code lenses', async () => {
		const language = 'r';
		const content = `#+
testing1
#+
testing2
#+
testing3`;
		const document = await vscode.workspace.openTextDocument({ language, content });
		const provider = new CellCodeLensProvider();

		const codeLenses = await provider.provideCodeLenses(document);

		assert.ok(codeLenses, 'No code lenses provided');
		verifyCodeLenses(codeLenses, [
			new vscode.Range(0, 0, 1, 8),
			new vscode.Range(2, 0, 3, 8),
			new vscode.Range(4, 0, 5, 8)
		]);
	});
});

function getCodeLenses(
	range: vscode.Range,
	isFirstCell: boolean = false,
	isLastCell: boolean = false
): vscode.CodeLens[] {
	const codeLenses = [runCellCodeLens(range)];
	if (!isFirstCell) {
		codeLenses.push(runAboveCodeLens(range));
	}
	if (!isLastCell) {
		codeLenses.push(runNextCodeLens(range));
	}
	return codeLenses;
}

function verifyCodeLenses(codeLenses: vscode.CodeLens[], expectedRanges: vscode.Range[]): void {
	const expectedCodeLenses: vscode.CodeLens[] = [];
	for (let i = 0; i < expectedRanges.length; i += 1) {
		const isFirstCell = i === 0;
		const isLastCell = i === expectedRanges.length - 1;
		expectedCodeLenses.push(...getCodeLenses(expectedRanges[i], isFirstCell, isLastCell));
	}

	assert.deepStrictEqual(codeLenses, expectedCodeLenses, 'Incorrect code lenses');
}
