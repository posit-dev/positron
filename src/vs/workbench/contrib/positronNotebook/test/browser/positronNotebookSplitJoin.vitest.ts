/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />


import { VSBuffer } from '../../../../../base/common/buffer.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
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
	expect(editor).toBeTruthy();
	editor.setSelections(selections);
}

describe('Split and Join Cells', () => {
	const ctx = createTestContainer().build();

	describe('splitCell', () => {

		it('splits cell mid-line', () => {
			const notebook = createTestPositronNotebookInstance(
				[['hello world', 'python', CellKind.Code]],
				ctx.disposables,
			);

			// Place cursor between "hello" and " world" (column 6)
			enterEditModeWithCursor(notebook, 0, [
				new Selection(1, 6, 1, 6),
			]);

			notebook.splitCell();

			const cells = notebook.cells.get();
			expect(cells.length).toBe(2);
			expect(cells[0].getContent()).toBe('hello');
			expect(cells[1].getContent()).toBe(' world');
		});

		it('splits cell at line boundary', () => {
			const notebook = createTestPositronNotebookInstance(
				[['line1\nline2\nline3', 'python', CellKind.Code]],
				ctx.disposables,
			);

			// Place cursor at start of line 2. The preceding newline
			// character is included in the first segment by getValueInRange.
			enterEditModeWithCursor(notebook, 0, [
				new Selection(2, 1, 2, 1),
			]);

			notebook.splitCell();

			const cells = notebook.cells.get();
			expect(cells.length).toBe(2);
			expect(cells[0].getContent()).toBe('line1\n');
			expect(cells[1].getContent()).toBe('line2\nline3');
		});

		it('split with multi-cursor creates multiple cells', () => {
			const notebook = createTestPositronNotebookInstance(
				[['aaabbbccc', 'python', CellKind.Code]],
				ctx.disposables,
			);

			// Place cursors at column 4 and 7 on a single line
			enterEditModeWithCursor(notebook, 0, [
				new Selection(1, 4, 1, 4),
				new Selection(1, 7, 1, 7),
			]);

			notebook.splitCell();

			const cells = notebook.cells.get();
			expect(cells.length).toBe(3);
			expect(cells[0].getContent()).toBe('aaa');
			expect(cells[1].getContent()).toBe('bbb');
			expect(cells[2].getContent()).toBe('ccc');
		});

		it('split at beginning of cell creates empty first cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[['hello world', 'python', CellKind.Code]],
				ctx.disposables,
			);

			// Place cursor at very start of cell
			enterEditModeWithCursor(notebook, 0, [
				new Selection(1, 1, 1, 1),
			]);

			notebook.splitCell();

			const cells = notebook.cells.get();
			expect(cells.length).toBe(2);
			expect(cells[0].getContent()).toBe('');
			expect(cells[1].getContent()).toBe('hello world');
		});

		it('split at end of cell creates empty last cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[['hello world', 'python', CellKind.Code]],
				ctx.disposables,
			);

			// Place cursor at end of content (line 1, after last character)
			enterEditModeWithCursor(notebook, 0, [
				new Selection(1, 12, 1, 12), // "hello world" is 11 chars, column 12 is after last
			]);

			notebook.splitCell();

			const cells = notebook.cells.get();
			expect(cells.length).toBe(2);
			expect(cells[0].getContent()).toBe('hello world');
			expect(cells[1].getContent()).toBe('');
		});

		it('split preserves outputs only on first cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[['hello world', 'python', CellKind.Code, [{
					outputId: 'test-output',
					outputs: [{ mime: 'text/plain', data: VSBuffer.alloc(0) }]
				}]]],
				ctx.disposables,
			);

			enterEditModeWithCursor(notebook, 0, [
				new Selection(1, 6, 1, 6),
			]);

			notebook.splitCell();

			const { textModel } = notebook;
			expect(textModel).toBeTruthy();
			expect(textModel!.cells[0].outputs.length).toBe(1);
			expect(textModel!.cells[1].outputs.length).toBe(0);
		});

		it('split preserves mime, internalMetadata, and collapseState on first cell', () => {
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
				ctx.disposables,
			);

			enterEditModeWithCursor(notebook, 0, [
				new Selection(1, 6, 1, 6),
			]);

			notebook.splitCell();

			const { textModel } = notebook;
			expect(textModel).toBeTruthy();
			expect(textModel!.cells.length).toBe(2);

			// First cell preserves all state
			expect(textModel!.cells[0].mime).toBe('text/x-python');
			expect(textModel!.cells[0].internalMetadata.executionOrder).toBe(5);
			expect(textModel!.cells[0].internalMetadata.lastRunSuccess).toBe(true);
			expect(textModel!.cells[0].collapseState).toEqual({ inputCollapsed: false, outputCollapsed: true });

			// Second cell gets mime but not execution state or collapse
			expect(textModel!.cells[1].mime).toBe('text/x-python');
			expect(textModel!.cells[1].internalMetadata.executionOrder).toBe(undefined);
			expect(textModel!.cells[1].collapseState).toBe(undefined);
		});

		it('split does nothing when not in edit mode', () => {
			const notebook = createTestPositronNotebookInstance(
				[['line1\nline2', 'python', CellKind.Code]],
				ctx.disposables,
			);

			// Select cell but don't enter edit mode
			const cell = notebook.cells.get()[0];
			notebook.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);

			notebook.splitCell();

			const cells = notebook.cells.get();
			expect(cells.length).toBe(1);
		});

		it('split does not affect other cells', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['cell0', 'python', CellKind.Code],
					['hello world', 'python', CellKind.Code],
					['cell2', 'python', CellKind.Code],
				],
				ctx.disposables,
			);

			enterEditModeWithCursor(notebook, 1, [
				new Selection(1, 6, 1, 6),
			]);

			notebook.splitCell();

			const cells = notebook.cells.get();
			expect(cells.length).toBe(4);
			expect(cells[0].getContent()).toBe('cell0');
			expect(cells[1].getContent()).toBe('hello');
			expect(cells[2].getContent()).toBe(' world');
			expect(cells[3].getContent()).toBe('cell2');
		});
	});

	describe('joinSelectedCells', () => {
		it('joins two selected code cells', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['line1', 'python', CellKind.Code],
					['line2', 'python', CellKind.Code],
				],
				ctx.disposables,
			);

			// Multi-select both cells
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);

			notebook.joinSelectedCells();

			const newCells = notebook.cells.get();
			expect(newCells.length).toBe(1);
			expect(newCells[0].getContent()).toBe('line1\nline2');
		});

		it('joins three selected cells in document order', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['a', 'python', CellKind.Code],
					['b', 'python', CellKind.Code],
					['c', 'python', CellKind.Code],
				],
				ctx.disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Add);

			notebook.joinSelectedCells();

			const newCells = notebook.cells.get();
			expect(newCells.length).toBe(1);
			expect(newCells[0].getContent()).toBe('a\nb\nc');
		});

		it('with single cell selected, joins with cell below', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['line1', 'python', CellKind.Code],
					['line2', 'python', CellKind.Code],
				],
				ctx.disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);

			notebook.joinSelectedCells();

			const newCells = notebook.cells.get();
			expect(newCells.length).toBe(1);
			expect(newCells[0].getContent()).toBe('line1\nline2');
		});

		it('joins cells of different types using first cell type', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['code cell', 'python', CellKind.Code],
					['# markdown', 'markdown', CellKind.Markup],
				],
				ctx.disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);

			notebook.joinSelectedCells();

			const newCells = notebook.cells.get();
			expect(newCells.length).toBe(1);
			expect(newCells[0].getContent()).toBe('code cell\n# markdown');
			expect(newCells[0].kind).toBe(CellKind.Code);
		});

		it('preserves outputs from first cell', () => {
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
				ctx.disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);

			notebook.joinSelectedCells();

			const { textModel } = notebook;
			expect(textModel).toBeTruthy();
			expect(textModel!.cells.length).toBe(1);
			// The first cell's outputs are preserved
			expect(textModel!.cells[0].outputs.length).toBe(1);
			expect(textModel!.cells[0].outputs[0].outputId).toBe('output-1');
		});

		it('preserves mime, internalMetadata, and collapseState from first cell', () => {
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
				ctx.disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);

			notebook.joinSelectedCells();

			const { textModel } = notebook;
			expect(textModel).toBeTruthy();
			expect(textModel!.cells.length).toBe(1);
			expect(textModel!.cells[0].mime).toBe('text/x-python');
			expect(textModel!.cells[0].internalMetadata.executionOrder).toBe(3);
			expect(textModel!.cells[0].internalMetadata.lastRunSuccess).toBe(true);
			expect(textModel!.cells[0].collapseState).toEqual({ inputCollapsed: false, outputCollapsed: true });
		});

		it('joins non-contiguous selection, leaving unselected cells intact', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['a', 'python', CellKind.Code],
					['b', 'python', CellKind.Code],
					['c', 'python', CellKind.Code],
				],
				ctx.disposables,
			);

			// Select cells 0 and 2, skipping cell 1
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Add);

			notebook.joinSelectedCells();

			const newCells = notebook.cells.get();
			// Non-contiguous selected cells are merged; unselected cell 1 remains
			expect(newCells.length).toBe(2);
			expect(newCells[0].getContent()).toBe('a\nc');
			expect(newCells[1].getContent()).toBe('b');
		});
	});

	describe('joinCellAbove', () => {
		it('joins active cell with cell above', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['above', 'python', CellKind.Code],
					['below', 'python', CellKind.Code],
				],
				ctx.disposables,
			);

			// Select the second cell
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1]);

			notebook.joinCellAbove();

			const newCells = notebook.cells.get();
			expect(newCells.length).toBe(1);
			expect(newCells[0].getContent()).toBe('above\nbelow');
		});

		it('does nothing when active cell is first cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['first', 'python', CellKind.Code],
					['second', 'python', CellKind.Code],
				],
				ctx.disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);

			notebook.joinCellAbove();

			const newCells = notebook.cells.get();
			expect(newCells.length).toBe(2);
		});

		it('joins cells of different types using active cell type', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['# markdown', 'markdown', CellKind.Markup],
					['code', 'python', CellKind.Code],
				],
				ctx.disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1]);

			notebook.joinCellAbove();

			const newCells = notebook.cells.get();
			expect(newCells.length).toBe(1);
			expect(newCells[0].getContent()).toBe('# markdown\ncode');
			expect(newCells[0].kind).toBe(CellKind.Code);
		});

		it('preserves mime, internalMetadata, and collapseState from active cell', () => {
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
						collapseState: { inputCollapsed: false, outputCollapsed: true },
					},
				],
				ctx.disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1]);

			notebook.joinCellAbove();

			const { textModel } = notebook;
			expect(textModel).toBeTruthy();
			expect(textModel!.cells.length).toBe(1);
			expect(textModel!.cells[0].mime).toBe('text/x-python');
			expect(textModel!.cells[0].internalMetadata.executionOrder).toBe(8);
			expect(textModel!.cells[0].collapseState).toEqual({ inputCollapsed: false, outputCollapsed: true });
		});
	});

	describe('joinCellBelow', () => {
		it('joins active cell with cell below', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['above', 'python', CellKind.Code],
					['below', 'python', CellKind.Code],
				],
				ctx.disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);

			notebook.joinCellBelow();

			const newCells = notebook.cells.get();
			expect(newCells.length).toBe(1);
			expect(newCells[0].getContent()).toBe('above\nbelow');
		});

		it('does nothing when active cell is last cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['first', 'python', CellKind.Code],
					['last', 'python', CellKind.Code],
				],
				ctx.disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1]);

			notebook.joinCellBelow();

			const newCells = notebook.cells.get();
			expect(newCells.length).toBe(2);
		});

		it('joins cells of different types using active cell type', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['code', 'python', CellKind.Code],
					['# markdown', 'markdown', CellKind.Markup],
				],
				ctx.disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);

			notebook.joinCellBelow();

			const newCells = notebook.cells.get();
			expect(newCells.length).toBe(1);
			expect(newCells[0].getContent()).toBe('code\n# markdown');
			expect(newCells[0].kind).toBe(CellKind.Code);
		});

		it('preserves mime, internalMetadata, and collapseState from active cell', () => {
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
				ctx.disposables,
			);

			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);

			notebook.joinCellBelow();

			const { textModel } = notebook;
			expect(textModel).toBeTruthy();
			expect(textModel!.cells.length).toBe(1);
			expect(textModel!.cells[0].mime).toBe('text/x-python');
			expect(textModel!.cells[0].internalMetadata.executionOrder).toBe(10);
			expect(textModel!.cells[0].collapseState).toEqual({ inputCollapsed: false, outputCollapsed: true });
		});
	});

	describe('split and join roundtrip', () => {

		it('mid-line split then join inserts newline at split point', () => {
			const originalContent = 'hello world';
			const notebook = createTestPositronNotebookInstance(
				[[originalContent, 'python', CellKind.Code]],
				ctx.disposables,
			);

			// Split mid-line at column 6
			enterEditModeWithCursor(notebook, 0, [
				new Selection(1, 6, 1, 6),
			]);
			notebook.splitCell();

			expect(notebook.cells.get().length).toBe(2);
			expect(notebook.cells.get()[0].getContent()).toBe('hello');
			expect(notebook.cells.get()[1].getContent()).toBe(' world');

			// Multi-select both cells and join
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0]);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);
			notebook.joinSelectedCells();

			const newCells = notebook.cells.get();
			expect(newCells.length).toBe(1);
			// Join inserts an EOL between segments, so the content has a newline
			// where the split was. This is expected: split+join at a mid-line
			// position turns the split point into a line break.
			expect(newCells[0].getContent()).toBe('hello\n world');
		});
	});
});
