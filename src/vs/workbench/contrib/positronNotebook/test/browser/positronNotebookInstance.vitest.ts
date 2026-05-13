/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { CellSelectionStatus } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { CellSelectionType, getSelectedCells, SelectionState } from '../../browser/selectionMachine.js';

describe('PositronNotebookInstance', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	/** Tests to ensure that the test harness is correctly setup, useful for debugging the test harness */
	describe('Test Harness', () => {
		it('notebook has cells from notebook text model', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['print("hello")', 'python', CellKind.Code],
					['print("world")', 'python', CellKind.Code],
				],
				ctx,
			);

			const cells = notebook.cells.get();
			expect(cells.length, 'Unexpected number of cells in notebook').toBe(2);
			expect(cells[0].model.getValue(), 'Unexpected content for notebook cell 0').toBe('print("hello")');
			expect(cells[1].model.getValue(), 'Unexpected content for notebook cell 1').toBe('print("world")');

			const { textModel } = notebook;
			expect(textModel, 'Notebook should have a text model').toBeDefined();
			expect(textModel!.cells[0].getValue(), 'Unexpected content for text model cell 0').toBe('print("hello")');
			expect(textModel!.cells[1].getValue(), 'Unexpected content for text model cell 1').toBe('print("world")');
		});
	});

	describe('selectionStateMachine', () => {
		it('multi-selection clears editing state from the previously edited cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['print("code")', 'python', CellKind.Code],
					['# markdown', 'markdown', CellKind.Markup],
				],
				ctx,
			);

			const [codeCell, markdownCell] = notebook.cells.get();

			notebook.selectionStateMachine.selectCell(codeCell, CellSelectionType.Edit);
			notebook.selectionStateMachine.selectCell(markdownCell, CellSelectionType.Add);

			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.MultiSelection);
			expect(getSelectedCells(state)).toEqual([codeCell, markdownCell]);
			expect(state.active).toBe(markdownCell);
			expect(codeCell.selectionStatus.get()).not.toBe(CellSelectionStatus.Editing);
			expect(codeCell.selectionStatus.get()).toBe(CellSelectionStatus.Selected);
			expect(markdownCell.selectionStatus.get()).toBe(CellSelectionStatus.Selected);
		});
	});

	describe('moveCells', () => {

		/** Helper: returns cell content values in current order. */
		function getCellValues(notebook: ReturnType<typeof createTestPositronNotebookInstance>): string[] {
			return notebook.cells.get().map(c => c.model.getValue());
		}

		/** Creates a 5-cell notebook labelled A-E for move tests. */
		function createFiveCellNotebook() {
			return createTestPositronNotebookInstance(
				['A', 'B', 'C', 'D', 'E'].map(v => [v, 'python', CellKind.Code]),
				ctx,
			);
		}

		it('contiguous: move single cell down', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move B (index 1) to after D (target index 4)
			notebook.moveCells([cells[1]], 4);
			expect(getCellValues(notebook)).toEqual(['A', 'C', 'D', 'B', 'E']);
		});

		it('contiguous: move single cell up', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move D (index 3) to before B (target index 1)
			notebook.moveCells([cells[3]], 1);
			expect(getCellValues(notebook)).toEqual(['A', 'D', 'B', 'C', 'E']);
		});

		it('contiguous: move block down', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move B,C (indices 1,2) to after D (target index 4)
			notebook.moveCells([cells[1], cells[2]], 4);
			expect(getCellValues(notebook)).toEqual(['A', 'D', 'B', 'C', 'E']);
		});

		it('contiguous: no-op when already at target', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move B (index 1) to target index 1 -- should be a no-op
			notebook.moveCells([cells[1]], 1);
			expect(getCellValues(notebook)).toEqual(['A', 'B', 'C', 'D', 'E']);
		});

		it('non-contiguous: move to end', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move B (1) and D (3) to after E (target index 5)
			notebook.moveCells([cells[1], cells[3]], 5);
			expect(getCellValues(notebook)).toEqual(['A', 'C', 'E', 'B', 'D']);
		});

		it('non-contiguous: move to beginning', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move B (1) and D (3) to before A (target index 0)
			notebook.moveCells([cells[1], cells[3]], 0);
			expect(getCellValues(notebook)).toEqual(['B', 'D', 'A', 'C', 'E']);
		});

		it('non-contiguous: move to middle', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move A (0) and D (3) to target index 2 (before C)
			notebook.moveCells([cells[0], cells[3]], 2);
			expect(getCellValues(notebook)).toEqual(['B', 'A', 'D', 'C', 'E']);
		});

		it('non-contiguous: does not move unselected cells between selected ones', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Move A (0) and C (2) to the end. B (1) should stay in place.
			notebook.moveCells([cells[0], cells[2]], 5);
			expect(getCellValues(notebook)).toEqual(['B', 'D', 'E', 'A', 'C']);
		});

		it('handles unsorted selection (cells passed in reverse order)', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Pass D (3) before B (1) -- moveCells should normalize order
			notebook.moveCells([cells[3], cells[1]], 5);
			expect(getCellValues(notebook)).toEqual(['A', 'C', 'E', 'B', 'D']);
		});

		it('handles duplicate cells in selection', () => {
			const notebook = createFiveCellNotebook();
			const cells = notebook.cells.get();
			// Pass B twice -- should deduplicate and move B once
			notebook.moveCells([cells[1], cells[1]], 4);
			expect(getCellValues(notebook)).toEqual(['A', 'C', 'D', 'B', 'E']);
		});
	});
});
