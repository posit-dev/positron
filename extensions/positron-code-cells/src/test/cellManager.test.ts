/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { CellManager, ExecuteCode } from '../cellManager';
import { closeAllEditors } from './utils';

suite('CellManager', () => {
	teardown(closeAllEditors);

	const language = 'python';
	const content = `#%%
testing1
#%%
testing2
#%%
testing3`;

	const cellTests: [string, string, number, string[], number, boolean][] = [
		// runCurrentCell
		['Test the runCurrentCell command passing the line arg', 'runCurrentCell', 2, ['testing2'], 0, false],
		['Test the runCurrentCell command using the active selection', 'runCurrentCell', 2, ['testing2'], 2, true],

		// runCurrentAdvance
		['Test the runCurrentAdvance command passing the line arg', 'runCurrentAdvance', 0, ['testing1'], 3, false],
		['Test the runCurrentAdvance command using the active selection', 'runCurrentAdvance', 0, ['testing1'], 3, true],
		['Test the runCurrentAdvance command at the last cell', 'runCurrentAdvance', 4, ['testing3'], 4, true],

		// runPreviousCell
		['Test the runPreviousCell command passing the line arg', 'runPreviousCell', 5, ['testing2'], 3, false],
		['Test the runPreviousCell command using the active selection', 'runPreviousCell', 5, ['testing2'], 3, true],
		['Test the runPreviousCell command at the first cell', 'runPreviousCell', 1, [], 1, true],

		// runNextCell
		['Test the runNextCell comamnd passing the line arg', 'runNextCell', 1, ['testing2'], 3, false],
		['Test the runNextCell command using the active selection', 'runNextCell', 1, ['testing2'], 3, true],
		['Test the runNextCell command at the last cell', 'runNextCell', 4, [], 4, true],

		// runCellsAbove
		['Test the runCellsAbove command passing the line arg', 'runCellsAbove', 5, ['testing1', 'testing2'], 0, false],
		['Test the runCellsAbove command using the active selection', 'runCellsAbove', 5, ['testing1', 'testing2'], 5, true],
		['Test the runCellsAbove command at the first cell', 'runCellsAbove', 1, [], 1, true],

		// runCellsBelow
		['Test the runCellsBelow command passing the line arg', 'runCellsBelow', 1, ['testing2', 'testing3'], 0, false],
		['Test the runCellsBelow command using the active selection', 'runCellsBelow', 1, ['testing2', 'testing3'], 1, true],
		['Test the runCellsBelow command on the last cell', 'runCellsBelow', 4, [], 4, true],

		/// runAllCells
		['Test the runAllCells command', 'runAllCells', 2, ['testing1', 'testing2', 'testing3'], 2, true],

		// goToPreviousCell
		['Test the goToPreviousCell command passing the line arg', 'goToPreviousCell', 5, [], 3, false],
		['Test the goToPreviousCell command using the active selection', 'goToPreviousCell', 5, [], 3, true],
		['Test the goToPreviousCell command on the first cell', 'goToPreviousCell', 1, [], 1, true],

		// goToNextCell
		['Test the goToNextCell command passing the line arg', 'goToNextCell', 1, [], 3, false],
		['Test the goToNextCell command using the active selection', 'goToNextCell', 1, [], 3, true],
		['Test the goToNextCell command on the last cell', 'goToNextCell', 4, [], 4, true],
	];
	cellTests.forEach(([title, command, line, expectedCode, expectedLine, useSelection]) => {
		test(title, async () => {
			const cellManager = await createCellManager(language, content);

			let lineArg: number | undefined;
			if (useSelection) {
				setSelectionLine(line);
			} else {
				lineArg = line;
			}

			const runCellCommand = getCellCommand(cellManager, command);
			await runCellCommand(lineArg);

			assertExecutedCodeEqual(cellManager.executedCode, language, expectedCode);
			assertActiveEditorSelectionEqual(expectedLine, 0);
		});
	});

	const insertCellTests: [string, boolean][] = [
		['Test the insertCell command passing the line arg', true],
		['Test the insertCell command using the active selection', false],
	];
	insertCellTests.forEach(([title, useSelection]) => {
		test(title, async () => {
			const line = 2;
			const cellManager = await createCellManager(language, content);

			let lineArg: number | undefined;
			if (useSelection) {
				setSelectionLine(line);
			} else {
				lineArg = line;
			}

			await cellManager.insertCodeCell(lineArg);

			assertExecutedCodeEqual(cellManager.executedCode, language, []);
			assertActiveEditorSelectionEqual(5, 0);
			assertActiveEditorTextEqual(`#%%
testing1
#%%
testing2
# %%

#%%
testing3`);
		});
	});
});

interface ExecuteCodeResult {
	language: string;
	code: string;
}

class TestCellManager extends CellManager {
	executedCode: ExecuteCodeResult[];

	constructor(
		editor: vscode.TextEditor,
	) {
		const executedCode: ExecuteCodeResult[] = [];
		const executeCode: ExecuteCode = async (language, code) => { executedCode.push({ language, code }); };

		super(editor, executeCode);
		this.executedCode = executedCode;
	}
}

async function createCellManager(language: string, content: string): Promise<TestCellManager> {
	const document = await vscode.workspace.openTextDocument({ language, content });
	const editor = await vscode.window.showTextDocument(document);
	const cellManager = new TestCellManager(editor);
	return cellManager;
}

function setSelectionLine(line: number) {
	vscode.window.activeTextEditor!.selection = new vscode.Selection(line, 0, line, 0);
}

function assertExecutedCodeEqual(actual: ExecuteCodeResult[], expectedLanguage: string, expectedCode: string[]) {
	const expected = expectedCode.map(code => ({ language: expectedLanguage, code }));
	assert.deepStrictEqual(actual, expected, 'Expected code was not executed');
}

function assertActiveEditorSelectionEqual(expectedLine: number, expectedCharacter: number) {
	const editor = vscode.window.activeTextEditor!;
	assert.strictEqual(editor.selection.active.line, expectedLine, 'Editor selection is not at the expected line');
	assert.strictEqual(editor.selection.active.character, expectedCharacter, 'Editor selection is not at the expected character');
}

function assertActiveEditorTextEqual(expectedText: string) {
	const editor = vscode.window.activeTextEditor!;
	assert.strictEqual(editor.document.getText(), expectedText, 'Editor text is not at the expected value');
}

function getCellCommand(cellManager: CellManager, command: string): (line?: number) => any {
	if (command === 'runCurrentCell') {
		return cellManager.runCurrentCell.bind(cellManager);
	}
	if (command === 'runCellsBelow') {
		return cellManager.runCellsBelow.bind(cellManager);
	}
	if (command === 'runCellsAbove') {
		return cellManager.runCellsAbove.bind(cellManager);
	}
	if (command === 'runCurrentAdvance') {
		return cellManager.runCurrentAdvance.bind(cellManager);
	}
	if (command === 'runPreviousCell') {
		return cellManager.runPreviousCell.bind(cellManager);
	}
	if (command === 'runNextCell') {
		return cellManager.runNextCell.bind(cellManager);
	}
	if (command === 'runAllCells') {
		return cellManager.runAllCells.bind(cellManager);
	}
	if (command === 'goToPreviousCell') {
		return cellManager.goToPreviousCell.bind(cellManager);
	}
	if (command === 'goToNextCell') {
		return cellManager.goToNextCell.bind(cellManager);
	}
	throw new Error(`Unknown cell command ${command}`);
}
