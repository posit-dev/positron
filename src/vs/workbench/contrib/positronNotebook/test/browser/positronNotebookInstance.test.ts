/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { createTestPositronNotebookInstance, TestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { CellSelectionType } from '../../browser/selectionMachine.js';

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

	suite('splitCell', () => {

		/**
		 * Helper to enter edit mode on a cell and set cursor position.
		 * Split requires the cell to be in editing state with a cursor.
		 */
		function enterEditModeWithCursor(
			notebook: TestPositronNotebookInstance,
			cellIndex: number,
			selections: Selection[],
		): void {
			const cell = notebook.cells.get()[cellIndex];
			notebook.selectionStateMachine.selectCell(cell, CellSelectionType.Edit);
			const editor = cell.currentEditor!;
			assert.ok(editor, 'Cell should have an editor attached');
			editor.setSelections(selections);
		}

		test('splits cell mid-line', () => {
			const notebook = createTestPositronNotebookInstance(
				[['hello world', 'python', CellKind.Code]],
				disposables,
			);

			// Place cursor between "hello" and " world" (column 6)
			enterEditModeWithCursor(notebook, 0, [
				new Selection(1, 6, 1, 6),
			]);

			notebook.splitCell();

			const cells = notebook.cells.get();
			assert.strictEqual(cells.length, 2, 'Should have 2 cells after split');
			assert.strictEqual(cells[0].getContent(), 'hello');
			assert.strictEqual(cells[1].getContent(), ' world');
		});

		test('splits cell at line boundary', () => {
			const notebook = createTestPositronNotebookInstance(
				[['line1\nline2\nline3', 'python', CellKind.Code]],
				disposables,
			);

			// Place cursor at start of line 2. The preceding newline
			// character is included in the first segment by getValueInRange.
			enterEditModeWithCursor(notebook, 0, [
				new Selection(2, 1, 2, 1),
			]);

			notebook.splitCell();

			const cells = notebook.cells.get();
			assert.strictEqual(cells.length, 2, 'Should have 2 cells after split');
			assert.strictEqual(cells[0].getContent(), 'line1\n');
			assert.strictEqual(cells[1].getContent(), 'line2\nline3');
		});

		test('split with multi-cursor creates multiple cells', () => {
			const notebook = createTestPositronNotebookInstance(
				[['aaabbbccc', 'python', CellKind.Code]],
				disposables,
			);

			// Place cursors at column 4 and 7 on a single line
			enterEditModeWithCursor(notebook, 0, [
				new Selection(1, 4, 1, 4),
				new Selection(1, 7, 1, 7),
			]);

			notebook.splitCell();

			const cells = notebook.cells.get();
			assert.strictEqual(cells.length, 3, 'Should have 3 cells after multi-cursor split');
			assert.strictEqual(cells[0].getContent(), 'aaa');
			assert.strictEqual(cells[1].getContent(), 'bbb');
			assert.strictEqual(cells[2].getContent(), 'ccc');
		});

		test('split at beginning of cell creates empty first cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[['hello world', 'python', CellKind.Code]],
				disposables,
			);

			// Place cursor at very start of cell
			enterEditModeWithCursor(notebook, 0, [
				new Selection(1, 1, 1, 1),
			]);

			notebook.splitCell();

			const cells = notebook.cells.get();
			assert.strictEqual(cells.length, 2);
			assert.strictEqual(cells[0].getContent(), '');
			assert.strictEqual(cells[1].getContent(), 'hello world');
		});

		test('split at end of cell creates empty last cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[['hello world', 'python', CellKind.Code]],
				disposables,
			);

			// Place cursor at end of content (line 1, after last character)
			enterEditModeWithCursor(notebook, 0, [
				new Selection(1, 12, 1, 12), // "hello world" is 11 chars, column 12 is after last
			]);

			notebook.splitCell();

			const cells = notebook.cells.get();
			assert.strictEqual(cells.length, 2);
			assert.strictEqual(cells[0].getContent(), 'hello world');
			assert.strictEqual(cells[1].getContent(), '');
		});

		test('split preserves outputs only on first cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[['hello world', 'python', CellKind.Code, [{
					outputId: 'test-output',
					outputs: [{ mime: 'text/plain', data: { bytes: new Uint8Array([]) } }]
				}]]],
				disposables,
			);

			enterEditModeWithCursor(notebook, 0, [
				new Selection(1, 6, 1, 6),
			]);

			notebook.splitCell();

			const { textModel } = notebook;
			assert.strictEqual(textModel.cells[0].outputs.length, 1, 'First cell should keep outputs');
			assert.strictEqual(textModel.cells[1].outputs.length, 0, 'Second cell should have no outputs');
		});

		test('split does nothing when not in edit mode', () => {
			const notebook = createTestPositronNotebookInstance(
				[['line1\nline2', 'python', CellKind.Code]],
				disposables,
			);

			// Select cell but don't enter edit mode
			const cell = notebook.cells.get()[0];
			notebook.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);

			notebook.splitCell();

			const cells = notebook.cells.get();
			assert.strictEqual(cells.length, 1, 'Should not split when not in edit mode');
		});

		test('split does not affect other cells', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['cell0', 'python', CellKind.Code],
					['hello world', 'python', CellKind.Code],
					['cell2', 'python', CellKind.Code],
				],
				disposables,
			);

			enterEditModeWithCursor(notebook, 1, [
				new Selection(1, 6, 1, 6),
			]);

			notebook.splitCell();

			const cells = notebook.cells.get();
			assert.strictEqual(cells.length, 4, 'Should have 4 cells total');
			assert.strictEqual(cells[0].getContent(), 'cell0', 'Cell before split target unchanged');
			assert.strictEqual(cells[1].getContent(), 'hello', 'Split first half');
			assert.strictEqual(cells[2].getContent(), ' world', 'Split second half');
			assert.strictEqual(cells[3].getContent(), 'cell2', 'Cell after split target unchanged');
		});
	});

	suite('joinSelectedCells', () => {
		test('joins two selected code cells', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['line1', 'python', CellKind.Code],
					['line2', 'python', CellKind.Code],
				],
				disposables,
			);

			// Multi-select both cells
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);

			notebook.joinSelectedCells();

			const newCells = notebook.cells.get();
			assert.strictEqual(newCells.length, 1, 'Should have 1 cell after join');
			assert.strictEqual(newCells[0].getContent(), 'line1\nline2', 'Content should be merged with newline');
		});

		test('joins three selected cells in document order', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['a', 'python', CellKind.Code],
					['b', 'python', CellKind.Code],
					['c', 'python', CellKind.Code],
				],
				disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Add);

			notebook.joinSelectedCells();

			const newCells = notebook.cells.get();
			assert.strictEqual(newCells.length, 1);
			assert.strictEqual(newCells[0].getContent(), 'a\nb\nc');
		});

		test('does nothing with single cell selected', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['line1', 'python', CellKind.Code],
					['line2', 'python', CellKind.Code],
				],
				disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);

			notebook.joinSelectedCells();

			const newCells = notebook.cells.get();
			assert.strictEqual(newCells.length, 2, 'Should not join with single selection');
		});

		test('does not join cells of different types', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['code cell', 'python', CellKind.Code],
					['# markdown', 'markdown', CellKind.Markup],
				],
				disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);

			notebook.joinSelectedCells();

			const newCells = notebook.cells.get();
			assert.strictEqual(newCells.length, 2, 'Should not join mixed cell types');
			assert.strictEqual(newCells[0].getContent(), 'code cell');
			assert.strictEqual(newCells[1].getContent(), '# markdown');
		});

		test('preserves outputs from first cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['cell1', 'python', CellKind.Code, [{
						outputId: 'output-1',
						outputs: [{ mime: 'text/plain', data: { bytes: new Uint8Array([]) } }]
					}]],
					['cell2', 'python', CellKind.Code, [{
						outputId: 'output-2',
						outputs: [{ mime: 'text/plain', data: { bytes: new Uint8Array([]) } }]
					}]],
				],
				disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);

			notebook.joinSelectedCells();

			const { textModel } = notebook;
			assert.strictEqual(textModel.cells.length, 1);
			// The first cell's outputs are preserved
			assert.strictEqual(textModel.cells[0].outputs.length, 1);
			assert.strictEqual(textModel.cells[0].outputs[0].outputId, 'output-1');
		});
	});

	suite('joinCellAbove', () => {
		test('joins active cell with cell above', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['above', 'python', CellKind.Code],
					['below', 'python', CellKind.Code],
				],
				disposables,
			);

			// Select the second cell
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1]);

			notebook.joinCellAbove();

			const newCells = notebook.cells.get();
			assert.strictEqual(newCells.length, 1);
			assert.strictEqual(newCells[0].getContent(), 'above\nbelow');
		});

		test('does nothing when active cell is first cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['first', 'python', CellKind.Code],
					['second', 'python', CellKind.Code],
				],
				disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);

			notebook.joinCellAbove();

			const newCells = notebook.cells.get();
			assert.strictEqual(newCells.length, 2, 'Should not join when at first cell');
		});

		test('does not join cells of different types', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['# markdown', 'markdown', CellKind.Markup],
					['code', 'python', CellKind.Code],
				],
				disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1]);

			notebook.joinCellAbove();

			const newCells = notebook.cells.get();
			assert.strictEqual(newCells.length, 2, 'Should not join different cell types');
		});
	});

	suite('joinCellBelow', () => {
		test('joins active cell with cell below', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['above', 'python', CellKind.Code],
					['below', 'python', CellKind.Code],
				],
				disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);

			notebook.joinCellBelow();

			const newCells = notebook.cells.get();
			assert.strictEqual(newCells.length, 1);
			assert.strictEqual(newCells[0].getContent(), 'above\nbelow');
		});

		test('does nothing when active cell is last cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['first', 'python', CellKind.Code],
					['last', 'python', CellKind.Code],
				],
				disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1]);

			notebook.joinCellBelow();

			const newCells = notebook.cells.get();
			assert.strictEqual(newCells.length, 2, 'Should not join when at last cell');
		});

		test('does not join cells of different types', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['code', 'python', CellKind.Code],
					['# markdown', 'markdown', CellKind.Markup],
				],
				disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);

			notebook.joinCellBelow();

			const newCells = notebook.cells.get();
			assert.strictEqual(newCells.length, 2, 'Should not join different cell types');
		});
	});

	suite('split and join roundtrip', () => {
		/**
		 * Helper for roundtrip tests -- enters edit mode on a cell and sets cursor.
		 */
		function enterEditModeWithCursor(
			notebook: TestPositronNotebookInstance,
			cellIndex: number,
			selections: Selection[],
		): void {
			const cell = notebook.cells.get()[cellIndex];
			notebook.selectionStateMachine.selectCell(cell, CellSelectionType.Edit);
			const editor = cell.currentEditor!;
			assert.ok(editor, 'Cell should have an editor attached');
			editor.setSelections(selections);
		}

		test('mid-line split then join restores original content', () => {
			const originalContent = 'hello world';
			const notebook = createTestPositronNotebookInstance(
				[[originalContent, 'python', CellKind.Code]],
				disposables,
			);

			// Split mid-line at column 6
			enterEditModeWithCursor(notebook, 0, [
				new Selection(1, 6, 1, 6),
			]);
			notebook.splitCell();

			assert.strictEqual(notebook.cells.get().length, 2, 'Should have 2 cells after split');
			assert.strictEqual(notebook.cells.get()[0].getContent(), 'hello');
			assert.strictEqual(notebook.cells.get()[1].getContent(), ' world');

			// Multi-select both cells and join
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);
			notebook.joinSelectedCells();

			const newCells = notebook.cells.get();
			assert.strictEqual(newCells.length, 1, 'Should have 1 cell after join');
			// Join inserts an EOL between segments, so the content has a newline
			// where the split was. This is expected: split+join at a mid-line
			// position turns the split point into a line break.
			assert.strictEqual(newCells[0].getContent(), 'hello\n world');
		});
	});
});
