/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { CellSelectionStatus } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { CellSelectionType, getSelectedCells, SelectionState } from '../../browser/selectionMachine.js';

suite('PositronNotebookInstance', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	/** Tests to ensure that the test harness is correctly setup, useful for debugging the test harness */
	suite('Test Harness', () => {
		test('notebook has cells from notebook text model', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['print("hello")', 'python', CellKind.Code],
					['print("world")', 'python', CellKind.Code],
				],
				disposables,
			);

			const cells = notebook.cells.get();
			assert.strictEqual(cells.length, 2, 'Unexpected number of cells in notebook');
			assert.strictEqual(cells[0].model.getValue(), 'print("hello")', 'Unexpected content for notebook cell 0');
			assert.strictEqual(cells[1].model.getValue(), 'print("world")', 'Unexpected content for notebook cell 1');

			const { textModel } = notebook;
			assert.ok(textModel, 'Notebook should have a text model');
			assert.strictEqual(textModel.cells[0].getValue(), 'print("hello")', 'Unexpected content for text model cell 0');
			assert.strictEqual(textModel.cells[1].getValue(), 'print("world")', 'Unexpected content for text model cell 1');
		});
	});

	suite('selectionStateMachine', () => {
		test('multi-selection clears editing state from the previously edited cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['print("code")', 'python', CellKind.Code],
					['# markdown', 'markdown', CellKind.Markup],
				],
				disposables,
			);

			const [codeCell, markdownCell] = notebook.cells.get();

			notebook.selectionStateMachine.selectCell(codeCell, CellSelectionType.Edit);
			notebook.selectionStateMachine.selectCell(markdownCell, CellSelectionType.Add);

			const state = notebook.selectionStateMachine.state.get();
			assert.strictEqual(state.type, SelectionState.MultiSelection);
			assert.deepStrictEqual(getSelectedCells(state), [codeCell, markdownCell]);
			assert.strictEqual(state.active, markdownCell);
			assert.notStrictEqual(codeCell.selectionStatus.get(), CellSelectionStatus.Editing);
			assert.strictEqual(codeCell.selectionStatus.get(), CellSelectionStatus.Selected);
			assert.strictEqual(markdownCell.selectionStatus.get(), CellSelectionStatus.Selected);
		});
	});
});
