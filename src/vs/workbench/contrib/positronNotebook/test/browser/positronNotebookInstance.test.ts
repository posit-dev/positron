/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { createTestPositronNotebookInstance, TestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { CellSelectionType } from '../../browser/selectionMachine.js';

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
					outputs: [{ mime: 'text/plain', data: VSBuffer.alloc(0) }]
				}]]],
				disposables,
			);

			enterEditModeWithCursor(notebook, 0, [
				new Selection(1, 6, 1, 6),
			]);

			notebook.splitCell();

			const { textModel } = notebook;
			assert.ok(textModel);
			assert.strictEqual(textModel.cells[0].outputs.length, 1, 'First cell should keep outputs');
			assert.strictEqual(textModel.cells[1].outputs.length, 0, 'Second cell should have no outputs');
		});

		test('split preserves mime, internalMetadata, and collapseState on first cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[{
					source: 'hello world',
					language: 'python',
					cellKind: CellKind.Code,
					mime: 'text/x-python',
					outputs: [],
					metadata: {},
					internalMetadata: { executionOrder: 5, lastRunSuccess: true },
					collapseState: { inputCollapsed: false, outputCollapsed: true },
				}],
				disposables,
			);

			enterEditModeWithCursor(notebook, 0, [
				new Selection(1, 6, 1, 6),
			]);

			notebook.splitCell();

			const { textModel } = notebook;
			assert.ok(textModel);
			assert.strictEqual(textModel.cells.length, 2);

			// First cell preserves all state
			assert.strictEqual(textModel.cells[0].mime, 'text/x-python', 'First cell should preserve mime');
			assert.strictEqual(textModel.cells[0].internalMetadata.executionOrder, 5, 'First cell should preserve executionOrder');
			assert.strictEqual(textModel.cells[0].internalMetadata.lastRunSuccess, true, 'First cell should preserve lastRunSuccess');
			assert.deepStrictEqual(textModel.cells[0].collapseState, { inputCollapsed: false, outputCollapsed: true }, 'First cell should preserve collapseState');

			// Second cell gets mime but not execution state or collapse
			assert.strictEqual(textModel.cells[1].mime, 'text/x-python', 'Second cell should preserve mime');
			assert.strictEqual(textModel.cells[1].internalMetadata.executionOrder, undefined, 'Second cell should not inherit executionOrder');
			assert.strictEqual(textModel.cells[1].collapseState, undefined, 'Second cell should not inherit collapseState');
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
						outputs: [{ mime: 'text/plain', data: VSBuffer.alloc(0) }]
					}]],
					['cell2', 'python', CellKind.Code, [{
						outputId: 'output-2',
						outputs: [{ mime: 'text/plain', data: VSBuffer.alloc(0) }]
					}]],
				],
				disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);

			notebook.joinSelectedCells();

			const { textModel } = notebook;
			assert.ok(textModel);
			assert.strictEqual(textModel.cells.length, 1);
			// The first cell's outputs are preserved
			assert.strictEqual(textModel.cells[0].outputs.length, 1);
			assert.strictEqual(textModel.cells[0].outputs[0].outputId, 'output-1');
		});

		test('preserves mime, internalMetadata, and collapseState from first cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					{
						source: 'cell1',
						language: 'python',
						cellKind: CellKind.Code,
						mime: 'text/x-python',
						outputs: [],
						metadata: {},
						internalMetadata: { executionOrder: 3, lastRunSuccess: true },
						collapseState: { inputCollapsed: false, outputCollapsed: true },
					},
					{
						source: 'cell2',
						language: 'python',
						cellKind: CellKind.Code,
						mime: 'text/x-python',
						outputs: [],
						metadata: {},
						internalMetadata: { executionOrder: 4, lastRunSuccess: false },
						collapseState: { inputCollapsed: true, outputCollapsed: false },
					},
				],
				disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);

			notebook.joinSelectedCells();

			const { textModel } = notebook;
			assert.ok(textModel);
			assert.strictEqual(textModel.cells.length, 1);
			assert.strictEqual(textModel.cells[0].mime, 'text/x-python', 'Should preserve mime from first cell');
			assert.strictEqual(textModel.cells[0].internalMetadata.executionOrder, 3, 'Should preserve executionOrder from first cell');
			assert.strictEqual(textModel.cells[0].internalMetadata.lastRunSuccess, true, 'Should preserve lastRunSuccess from first cell');
			assert.deepStrictEqual(textModel.cells[0].collapseState, { inputCollapsed: false, outputCollapsed: true }, 'Should preserve collapseState from first cell');
		});

		test('joins non-contiguous selection, leaving unselected cells intact', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['a', 'python', CellKind.Code],
					['b', 'python', CellKind.Code],
					['c', 'python', CellKind.Code],
				],
				disposables,
			);

			// Select cells 0 and 2, skipping cell 1
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Add);

			notebook.joinSelectedCells();

			const newCells = notebook.cells.get();
			// Non-contiguous selected cells are merged; unselected cell 1 remains
			assert.strictEqual(newCells.length, 2);
			assert.strictEqual(newCells[0].getContent(), 'a\nc');
			assert.strictEqual(newCells[1].getContent(), 'b');
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

		test('preserves mime, internalMetadata, and collapseState from above cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					{
						source: 'above',
						language: 'python',
						cellKind: CellKind.Code,
						mime: 'text/x-python',
						outputs: [],
						metadata: {},
						internalMetadata: { executionOrder: 7 },
						collapseState: { inputCollapsed: true, outputCollapsed: false },
					},
					{
						source: 'below',
						language: 'python',
						cellKind: CellKind.Code,
						mime: 'text/x-python',
						outputs: [],
						metadata: {},
						internalMetadata: { executionOrder: 8 },
					},
				],
				disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1]);

			notebook.joinCellAbove();

			const { textModel } = notebook;
			assert.ok(textModel);
			assert.strictEqual(textModel.cells.length, 1);
			assert.strictEqual(textModel.cells[0].mime, 'text/x-python', 'Should preserve mime from above cell');
			assert.strictEqual(textModel.cells[0].internalMetadata.executionOrder, 7, 'Should preserve executionOrder from above cell');
			assert.deepStrictEqual(textModel.cells[0].collapseState, { inputCollapsed: true, outputCollapsed: false }, 'Should preserve collapseState from above cell');
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

		test('preserves mime, internalMetadata, and collapseState from active cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					{
						source: 'active',
						language: 'python',
						cellKind: CellKind.Code,
						mime: 'text/x-python',
						outputs: [],
						metadata: {},
						internalMetadata: { executionOrder: 10 },
						collapseState: { inputCollapsed: false, outputCollapsed: true },
					},
					{
						source: 'below',
						language: 'python',
						cellKind: CellKind.Code,
						mime: 'text/x-python',
						outputs: [],
						metadata: {},
						internalMetadata: { executionOrder: 11 },
					},
				],
				disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);

			notebook.joinCellBelow();

			const { textModel } = notebook;
			assert.ok(textModel);
			assert.strictEqual(textModel.cells.length, 1);
			assert.strictEqual(textModel.cells[0].mime, 'text/x-python', 'Should preserve mime from active cell');
			assert.strictEqual(textModel.cells[0].internalMetadata.executionOrder, 10, 'Should preserve executionOrder from active cell');
			assert.deepStrictEqual(textModel.cells[0].collapseState, { inputCollapsed: false, outputCollapsed: true }, 'Should preserve collapseState from active cell');
		});
	});

	suite('split and join roundtrip', () => {

		test('mid-line split then join inserts newline at split point', () => {
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
