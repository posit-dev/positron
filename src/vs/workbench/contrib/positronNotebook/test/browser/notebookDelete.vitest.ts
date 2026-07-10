/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { KeyChord, KeyCode } from '../../../../../base/common/keyCodes.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { singleKeybinding } from './keybindingTestUtils.js';
import {
	DeleteCellAction,
	POSITRON_NOTEBOOK_COMMAND_MODE,
} from '../../browser/positronNotebook.contribution.js';
import {
	CellSelectionType,
	getActiveCell,
	SelectionState,
} from '../../browser/selectionMachine.js';
import {
	createLabelledTestNotebook,
	createTestPositronNotebookInstance,
} from './testPositronNotebookInstance.js';

// The cross-pane action-bar button click path is covered by the
// notebook-cell-action-bar e2e; this file covers the model API and keybindings.
describe('PositronNotebookInstance.delete*', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	describe('deleteCell (single cell)', () => {
		it('deleting a middle cell from a mixed code+markdown notebook moves focus to the next cell', () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['### Cell 2', 'markdown', CellKind.Markup],
				['### Cell 3', 'markdown', CellKind.Markup],
			], ctx);
			const cellsBefore = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsBefore[2], CellSelectionType.Normal);

			notebook.deleteCell(cellsBefore[2]);

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(3);
			expect(cellsAfter.map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 1',
				'### Cell 3',
			]);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cellsAfter[2]);
		});

		it('deleting the last cell moves focus up to the previous cell', () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['### Cell 3', 'markdown', CellKind.Markup],
			], ctx);
			const cellsBefore = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cellsBefore[2], CellSelectionType.Normal);

			notebook.deleteCell(cellsBefore[2]);

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(2);
			expect(cellsAfter.map(c => c.getContent())).toEqual(['# Cell 0', '# Cell 1']);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cellsAfter[1]);
		});

		it('deleteCell() with no argument deletes the active cell', () => {
			const notebook = createLabelledTestNotebook(3, ctx);
			const cellsBefore = notebook.cells.get();
			const targetContent = cellsBefore[1].getContent();
			notebook.selectionStateMachine.selectCell(cellsBefore[1], CellSelectionType.Normal);

			notebook.deleteCell();

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(2);
			expect(cellsAfter.map(c => c.getContent())).not.toContain(targetContent);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cellsAfter[1]);
		});

		it('deleteCell() is a no-op on an empty notebook', () => {
			const notebook = createTestPositronNotebookInstance([], ctx);

			expect(() => notebook.deleteCell()).not.toThrow();

			expect(notebook.cells.get().length).toBe(0);
		});
	});

	describe('deleteCells (multi cell)', () => {
		it('deleting a contiguous middle block leaves surrounding cells intact and selects the lowest deleted index', () => {
			const notebook = createTestPositronNotebookInstance(
				Array.from({ length: 8 }, (_, i): [string, string, CellKind] => [
					`# Cell ${i}`,
					'python',
					CellKind.Code,
				]),
				ctx,
			);
			const cellsBefore = notebook.cells.get();
			const toDelete = [cellsBefore[1], cellsBefore[2], cellsBefore[3]];
			notebook.selectionStateMachine.selectCell(toDelete[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(toDelete[1], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(toDelete[2], CellSelectionType.Add);

			notebook.deleteCells(toDelete);

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(5);
			expect(cellsAfter.map(c => c.getContent())).toEqual([
				'# Cell 0',
				'# Cell 4',
				'# Cell 5',
				'# Cell 6',
				'# Cell 7',
			]);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cellsAfter[1]);
		});

		it('deleting a contiguous block at the end selects the new last cell', () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 4', 'python', CellKind.Code],
				['# Cell 5', 'python', CellKind.Code],
				['# Cell 6', 'python', CellKind.Code],
				['# Cell 7', 'python', CellKind.Code],
			], ctx);
			const cellsBefore = notebook.cells.get();
			const toDelete = [cellsBefore[2], cellsBefore[3], cellsBefore[4]];
			// Selection state must include the cells being deleted; otherwise the
			// selection machine keeps the previously-active surviving cell and the
			// post-delete neighbor-selection path never runs.
			notebook.selectionStateMachine.selectCell(toDelete[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(toDelete[1], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(toDelete[2], CellSelectionType.Add);

			notebook.deleteCells(toDelete);

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(2);
			expect(cellsAfter.map(c => c.getContent())).toEqual(['# Cell 0', '# Cell 4']);
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cellsAfter[1]);
		});

		it('non-sorted index order still deletes the correct cells', () => {
			const notebook = createLabelledTestNotebook(5, ctx);
			const cellsBefore = notebook.cells.get();
			const A = cellsBefore[0].getContent();
			const C = cellsBefore[2].getContent();
			const E = cellsBefore[4].getContent();
			// Deliberately out of order: 4, 0, 2 -- exercises the descending-sort
			// step that prevents mis-indexing during apply-edits.
			const toDelete = [cellsBefore[4], cellsBefore[0], cellsBefore[2]];

			notebook.deleteCells(toDelete);

			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(2);
			const remaining = cellsAfter.map(c => c.getContent());
			expect(remaining).not.toContain(A);
			expect(remaining).not.toContain(C);
			expect(remaining).not.toContain(E);
		});

		it('deleteCells([]) is a no-op', () => {
			const notebook = createLabelledTestNotebook(3, ctx);
			const before = notebook.cells.get().map(c => c.getContent());

			expect(() => notebook.deleteCells([])).not.toThrow();

			expect(notebook.cells.get().map(c => c.getContent())).toEqual(before);
		});
	});

	describe('DeleteCellAction (Backspace / D D keybinding)', () => {
		// Test-only subclass exposes the protected `runNotebookAction` so we can
		// invoke the action body without standing up an active editor pane.
		class TestableDeleteCellAction extends DeleteCellAction {
			public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
				return this.runNotebookAction(notebook, accessor);
			}
		}

		const unusedAccessor: ServicesAccessor = {
			get() { throw new Error('ServicesAccessor must not be used in this action test'); },
		};

		it('declares Backspace and D D keybindings scoped to command mode', () => {
			const action = new DeleteCellAction();
			expect(action.desc.id).toBe('positronNotebook.cell.delete');
			expect(singleKeybinding(action.desc.keybinding)?.primary).toBe(KeyCode.Backspace);
			expect(singleKeybinding(action.desc.keybinding)?.secondary).toEqual([
				KeyChord(KeyCode.KeyD, KeyCode.KeyD),
			]);
			expect(singleKeybinding(action.desc.keybinding)?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('invoking the action calls deleteCells() on the notebook', () => {
			const notebook = createLabelledTestNotebook(3, ctx);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Normal);
			const spy = vi.spyOn(notebook, 'deleteCells');

			new TestableDeleteCellAction().testRun(notebook, unusedAccessor);

			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy).toHaveBeenCalledWith();
			expect(notebook.cells.get().length).toBe(2);
		});
	});
});
