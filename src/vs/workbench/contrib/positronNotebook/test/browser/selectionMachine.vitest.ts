/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { CellSelectionStatus, IPositronNotebookCell } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import {
	CellSelectionType,
	getActiveCell,
	getEditingCell,
	getSelectedCells,
	SelectionState,
	toCellRanges,
} from '../../browser/selectionMachine.js';

describe('SelectionStateMachine', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	/** Build an N-cell notebook labelled A, B, C, ... for selection-machine tests. */
	function createNotebookWithNCells(n: number) {
		const labels = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
		return createTestPositronNotebookInstance(
			labels.map(v => [v, 'python', CellKind.Code]),
			ctx,
		);
	}

	describe('initial state', () => {
		it('empty notebook is in NoCells state', () => {
			const notebook = createTestPositronNotebookInstance([], ctx);
			expect(notebook.selectionStateMachine.state.get().type).toBe(SelectionState.NoCells);
		});

		it('populated notebook auto-selects the first cell after model is set', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cells[0]);
		});
	});

	describe('selectCell', () => {
		it('Normal: single-selects the given cell', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Normal);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cells[1]);
			expect(cells[1].selectionStatus.get()).toBe(CellSelectionStatus.Selected);
			expect(cells[0].selectionStatus.get()).toBe(CellSelectionStatus.Unselected);
		});

		it('Edit: enters editing state for the given cell', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Edit);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.EditingSelection);
			expect(getActiveCell(state)).toBe(cells[2]);
			expect(getEditingCell(state)).toBe(cells[2]);
			expect(cells[2].selectionStatus.get()).toBe(CellSelectionStatus.Editing);
		});

		it('Add from SingleSelection: expands to MultiSelection with new cell as active', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.MultiSelection);
			expect(getSelectedCells(state)).toEqual([cells[0], cells[1]]);
			expect(getActiveCell(state)).toBe(cells[1]);
		});

		it('Add from EditingSelection: transitions to MultiSelection and clears editing on prior cell', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Edit);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.MultiSelection);
			expect(getSelectedCells(state)).toEqual([cells[0], cells[1]]);
			expect(getActiveCell(state)).toBe(cells[1]);
			expect(cells[0].selectionStatus.get()).toBe(CellSelectionStatus.Selected);
		});

		it('Add with the same editing cell is a no-op', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Edit);
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Add);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.EditingSelection);
		});

		it('Add for an already-selected cell in Multi is a no-op', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Add);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.MultiSelection);
			expect(getSelectedCells(state)).toEqual([cells[0], cells[1]]);
			// Active should remain the cell from the first Add (cells[1])
			expect(getActiveCell(state)).toBe(cells[1]);
		});
	});

	describe('deselectCell', () => {
		it('deselecting the active SingleSelection cell selects the first cell', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Normal);
			notebook.selectionStateMachine.deselectCell(cells[2]);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cells[0]);
		});

		it('deselecting a non-active Multi cell reduces selection but keeps active', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Add);
			// Active is cells[2]; deselect cells[0]
			notebook.selectionStateMachine.deselectCell(cells[0]);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.MultiSelection);
			expect(getSelectedCells(state)).toEqual([cells[1], cells[2]]);
			expect(getActiveCell(state)).toBe(cells[2]);
		});

		it('deselecting the active Multi cell promotes the last remaining selected cell to active', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Add);
			// Active is cells[2]; deselect cells[2]
			notebook.selectionStateMachine.deselectCell(cells[2]);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.MultiSelection);
			expect(getSelectedCells(state)).toEqual([cells[0], cells[1]]);
			expect(getActiveCell(state)).toBe(cells[1]);
		});

		it('deselecting from Multi until one cell remains transitions to SingleSelection', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);
			notebook.selectionStateMachine.deselectCell(cells[0]);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cells[1]);
		});

		it('deselecting an unselected cell is a no-op', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.deselectCell(cells[2]);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cells[0]);
		});
	});

	describe('moveSelection (no addMode)', () => {
		it('moveSelectionDown moves to next cell from SingleSelection', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.moveSelectionDown(false);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cells[1]);
		});

		it('moveSelectionUp moves to previous cell from SingleSelection', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Normal);
			notebook.selectionStateMachine.moveSelectionUp(false);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cells[1]);
		});

		it('moveSelectionUp at first cell is a no-op', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.moveSelectionUp(false);
			const state = notebook.selectionStateMachine.state.get();
			expect(getActiveCell(state)).toBe(cells[0]);
		});

		it('moveSelectionDown at last cell is a no-op', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Normal);
			notebook.selectionStateMachine.moveSelectionDown(false);
			const state = notebook.selectionStateMachine.state.get();
			expect(getActiveCell(state)).toBe(cells[2]);
		});

		it('moveSelectionDown from MultiSelection collapses to next cell', () => {
			const notebook = createNotebookWithNCells(4);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);
			notebook.selectionStateMachine.moveSelectionDown(false);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cells[2]);
		});

		it('moveSelection while editing is a no-op', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Edit);
			notebook.selectionStateMachine.moveSelectionDown(false);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.EditingSelection);
			expect(getActiveCell(state)).toBe(cells[1]);
		});
	});

	describe('moveSelection (addMode)', () => {
		it('moveSelectionDown with addMode from SingleSelection grows to MultiSelection', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.moveSelectionDown(true);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.MultiSelection);
			expect(getSelectedCells(state)).toEqual([cells[0], cells[1]]);
			expect(getActiveCell(state)).toBe(cells[1]);
		});

		it('moveSelectionUp with addMode from SingleSelection grows to MultiSelection (reversed)', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Normal);
			notebook.selectionStateMachine.moveSelectionUp(true);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.MultiSelection);
			expect(getSelectedCells(state)).toEqual([cells[1], cells[2]]);
			expect(getActiveCell(state)).toBe(cells[1]);
		});

		it('moveSelectionDown with addMode further grows MultiSelection', () => {
			const notebook = createNotebookWithNCells(4);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.moveSelectionDown(true);
			notebook.selectionStateMachine.moveSelectionDown(true);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.MultiSelection);
			expect(getSelectedCells(state)).toEqual([cells[0], cells[1], cells[2]]);
			expect(getActiveCell(state)).toBe(cells[2]);
		});

		it('moveSelectionUp with addMode shrinks MultiSelection when next cell is already selected', () => {
			const notebook = createNotebookWithNCells(4);
			const cells = notebook.cells.get();
			// Build [0,1,2] with active=cells[2]
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.moveSelectionDown(true);
			notebook.selectionStateMachine.moveSelectionDown(true);
			// Now move up with addMode: cells[1] is already selected, so this shrinks
			notebook.selectionStateMachine.moveSelectionUp(true);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.MultiSelection);
			expect(getSelectedCells(state)).toEqual([cells[0], cells[1]]);
			expect(getActiveCell(state)).toBe(cells[1]);
		});

		it('moveSelectionUp with addMode at first cell is a no-op', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.moveSelectionUp(true);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cells[0]);
		});

		it('moveSelectionDown with addMode at last cell is a no-op', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Normal);
			notebook.selectionStateMachine.moveSelectionDown(true);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cells[2]);
		});
	});

	describe('enterEditor / exitEditor', () => {
		it('enterEditor on the active cell transitions to EditingSelection', async () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Normal);
			await notebook.selectionStateMachine.enterEditor();
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.EditingSelection);
			expect(getActiveCell(state)).toBe(cells[1]);
		});

		it('enterEditor with explicit cell switches editing target', async () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Edit);
			await notebook.selectionStateMachine.enterEditor(cells[2]);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.EditingSelection);
			expect(getEditingCell(state)).toBe(cells[2]);
		});

		it('exitEditor returns to SingleSelection on the same cell', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Edit);
			notebook.selectionStateMachine.exitEditor();
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cells[1]);
		});

		it('exitEditor with mismatched cell does not exit (race-condition guard)', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Edit);
			// Pretend a focus event for cells[2] arrived while we're editing cells[1]
			notebook.selectionStateMachine.exitEditor(cells[2]);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.EditingSelection);
			expect(getEditingCell(state)).toBe(cells[1]);
		});

		it('exitEditor when not editing is a no-op', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Normal);
			notebook.selectionStateMachine.exitEditor();
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cells[1]);
		});
	});

	describe('cell array changes', () => {
		it('deleting the editing cell selects a neighboring cell', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Edit);
			notebook.deleteCell(cells[1]);
			const state = notebook.selectionStateMachine.state.get();
			// After deletion, the cell that took position 1 should be selected
			expect(state.type).toBe(SelectionState.SingleSelection);
			const remaining = notebook.cells.get();
			expect(getActiveCell(state)).toBe(remaining[1]);
		});

		it('deleting the only selected cell when others remain promotes a neighbor', () => {
			const notebook = createNotebookWithNCells(3);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Normal);
			notebook.deleteCell(cells[2]);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			// cells[2] was the last, so promotion falls back to the new last cell
			const remaining = notebook.cells.get();
			expect(getActiveCell(state)).toBe(remaining[remaining.length - 1]);
		});

		it('deleting a cell from MultiSelection retains remaining selected cells', () => {
			const notebook = createNotebookWithNCells(4);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Add);
			notebook.deleteCell(cells[1]);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.MultiSelection);
			const remaining = notebook.cells.get();
			// cells[0] and the cell formerly at index 2 (now at index 1) survive
			expect(getSelectedCells(state)).toEqual([remaining[0], remaining[1]]);
		});

		it('deleting all cells transitions to NoCells', () => {
			const notebook = createNotebookWithNCells(2);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.deleteCells([cells[0], cells[1]]);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.NoCells);
		});
	});

	describe('pure helpers', () => {
		it('getSelectedCells returns [] for NoCells', () => {
			expect(getSelectedCells({ type: SelectionState.NoCells })).toEqual([]);
		});

		it('getSelectedCells returns [active] for SingleSelection', () => {
			const fakeCell = stubInterface<IPositronNotebookCell>({ index: 0 });
			expect(getSelectedCells({ type: SelectionState.SingleSelection, active: fakeCell })).toEqual([fakeCell]);
		});

		it('getSelectedCells returns [active] for EditingSelection', () => {
			const fakeCell = stubInterface<IPositronNotebookCell>({ index: 0 });
			expect(getSelectedCells({ type: SelectionState.EditingSelection, active: fakeCell })).toEqual([fakeCell]);
		});

		it('getActiveCell returns null for NoCells', () => {
			expect(getActiveCell({ type: SelectionState.NoCells })).toBeNull();
		});

		it('getEditingCell returns null when not editing', () => {
			const fakeCell = stubInterface<IPositronNotebookCell>({ index: 0 });
			expect(getEditingCell({ type: SelectionState.SingleSelection, active: fakeCell })).toBeNull();
		});

		it('toCellRanges groups consecutive selected cells into one range', () => {
			const c0 = stubInterface<IPositronNotebookCell>({ index: 0 });
			const c1 = stubInterface<IPositronNotebookCell>({ index: 1 });
			const c2 = stubInterface<IPositronNotebookCell>({ index: 2 });
			const ranges = toCellRanges({
				type: SelectionState.MultiSelection,
				selected: [c0, c1, c2],
				active: c2,
			});
			expect(ranges).toEqual([{ start: 0, end: 3 }]);
		});

		it('toCellRanges splits non-consecutive cells into multiple ranges', () => {
			const c0 = stubInterface<IPositronNotebookCell>({ index: 0 });
			const c2 = stubInterface<IPositronNotebookCell>({ index: 2 });
			const c4 = stubInterface<IPositronNotebookCell>({ index: 4 });
			const c5 = stubInterface<IPositronNotebookCell>({ index: 5 });
			const ranges = toCellRanges({
				type: SelectionState.MultiSelection,
				selected: [c0, c2, c4, c5],
				active: c5,
			});
			expect(ranges).toEqual([
				{ start: 0, end: 1 },
				{ start: 2, end: 3 },
				{ start: 4, end: 6 },
			]);
		});

		it('toCellRanges returns [] for NoCells', () => {
			expect(toCellRanges({ type: SelectionState.NoCells })).toEqual([]);
		});

		it('toCellRanges returns single range for SingleSelection', () => {
			const fakeCell = stubInterface<IPositronNotebookCell>({ index: 3 });
			expect(toCellRanges({ type: SelectionState.SingleSelection, active: fakeCell })).toEqual([
				{ start: 3, end: 4 },
			]);
		});
	});
});
