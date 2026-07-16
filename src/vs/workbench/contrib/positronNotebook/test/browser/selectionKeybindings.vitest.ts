/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellContextKeys } from '../../common/cellContextKeys.js';
import { NotebookContextKeys } from '../../common/notebookContextKeys.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { CellSelectionType, getActiveCell, getSelectedCells, SelectionState } from '../../browser/selectionMachine.js';
import {
	AddSelectionDownAction,
	AddSelectionUpAction,
	MoveCellDownAction,
	MoveCellUpAction,
	POSITRON_NOTEBOOK_COMMAND_MODE,
	ReduceSelectionToActiveCellAction,
	SelectDownAction,
	SelectUpAction,
} from '../../browser/positronNotebook.contribution.js';
import { createLabelledTestNotebook } from './testPositronNotebookInstance.js';
import { singleKeybinding } from './keybindingTestUtils.js';

/**
 * Verifies that the notebook's keyboard navigation actions (registered in
 * positronNotebook.contribution.ts) are wired correctly. Each test asserts
 * BOTH halves of the wiring:
 *  - Keybinding metadata: the action declares the expected key and when-clause.
 *  - Behavior: invoking the action calls the matching SelectionStateMachine method.
 *
 * This pair of assertions is what would have broken if a developer accidentally
 * removed a keybinding entry, swapped the key, or rewired the action body to
 * call the wrong state-machine method -- previously caught by e2e but now
 * unit-tested.
 */
describe('Notebook selection keybinding actions', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	// Test-only subclasses that expose the protected `runNotebookAction` so we
	// can invoke action behavior without standing up an active editor pane.
	// Keeping the parent method protected preserves the production API boundary
	// (production callers must still go through `run()`).
	class TestableSelectUpAction extends SelectUpAction {
		public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}
	class TestableSelectDownAction extends SelectDownAction {
		public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}
	class TestableReduceSelectionToActiveCellAction extends ReduceSelectionToActiveCellAction {
		public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}
	class TestableAddSelectionDownAction extends AddSelectionDownAction {
		public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}
	class TestableAddSelectionUpAction extends AddSelectionUpAction {
		public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}
	class TestableMoveCellUpAction extends MoveCellUpAction {
		public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}
	class TestableMoveCellDownAction extends MoveCellDownAction {
		public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}

	// runNotebookAction takes a ServicesAccessor that these actions never read.
	// Pass a stub that throws clearly if any future implementation reaches for it.
	const unusedAccessor: ServicesAccessor = {
		get() { throw new Error('ServicesAccessor must not be used in this action test'); },
	};

	describe('SelectUpAction (ArrowUp / K)', () => {
		it('declares ArrowUp keybinding scoped to command mode', () => {
			const action = new SelectUpAction();
			expect(action.desc.id).toBe('positronNotebook.selectUp');
			expect(singleKeybinding(action.desc.keybinding)?.primary).toBe(KeyCode.UpArrow);
			expect(singleKeybinding(action.desc.keybinding)?.secondary).toEqual([KeyCode.KeyK]);
			expect(singleKeybinding(action.desc.keybinding)?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('moves selection up by one cell from SingleSelection', () => {
			const notebook = createLabelledTestNotebook(3, ctx);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Normal);

			new TestableSelectUpAction().testRun(notebook, unusedAccessor);

			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cells[1]);
		});
	});

	describe('SelectDownAction (ArrowDown / J)', () => {
		it('declares ArrowDown keybinding scoped to command mode', () => {
			const action = new SelectDownAction();
			expect(action.desc.id).toBe('positronNotebook.selectDown');
			expect(singleKeybinding(action.desc.keybinding)?.primary).toBe(KeyCode.DownArrow);
			expect(singleKeybinding(action.desc.keybinding)?.secondary).toEqual([KeyCode.KeyJ]);
			expect(singleKeybinding(action.desc.keybinding)?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('calls moveSelectionDown(false) on the active notebook', () => {
			const notebook = createLabelledTestNotebook(3, ctx);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);

			new TestableSelectDownAction().testRun(notebook, unusedAccessor);

			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cells[1]);
		});
	});

	describe('ReduceSelectionToActiveCellAction (Escape)', () => {
		it('declares Escape keybinding scoped to command mode', () => {
			const action = new ReduceSelectionToActiveCellAction();
			expect(action.desc.id).toBe('positronNotebook.reduceSelectionToActiveCell');
			expect(singleKeybinding(action.desc.keybinding)?.primary).toBe(KeyCode.Escape);
			expect(singleKeybinding(action.desc.keybinding)?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('collapses MultiSelection to SingleSelection on the active cell', () => {
			const notebook = createLabelledTestNotebook(3, ctx);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Add);

			new TestableReduceSelectionToActiveCellAction().testRun(notebook, unusedAccessor);

			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cells[2]);
		});

		it('is a no-op in SingleSelection', () => {
			const notebook = createLabelledTestNotebook(3, ctx);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Normal);

			new TestableReduceSelectionToActiveCellAction().testRun(notebook, unusedAccessor);

			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(getActiveCell(state)).toBe(cells[1]);
		});
	});

	describe('AddSelectionDownAction (Shift+ArrowDown / Shift+J)', () => {
		it('declares Shift+ArrowDown keybinding scoped to command mode', () => {
			const action = new AddSelectionDownAction();
			expect(action.desc.id).toBe('positronNotebook.addSelectionDown');
			expect(singleKeybinding(action.desc.keybinding)?.primary).toBe(KeyMod.Shift | KeyCode.DownArrow);
			expect(singleKeybinding(action.desc.keybinding)?.secondary).toEqual([KeyMod.Shift | KeyCode.KeyJ]);
			expect(singleKeybinding(action.desc.keybinding)?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('calls moveSelectionDown(true) -- grows MultiSelection downward', () => {
			const notebook = createLabelledTestNotebook(3, ctx);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);

			new TestableAddSelectionDownAction().testRun(notebook, unusedAccessor);

			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.MultiSelection);
			expect(getSelectedCells(state)).toEqual([cells[0], cells[1]]);
			expect(getActiveCell(state)).toBe(cells[1]);
		});
	});

	describe('AddSelectionUpAction (Shift+ArrowUp / Shift+K)', () => {
		it('declares Shift+ArrowUp keybinding scoped to command mode', () => {
			const action = new AddSelectionUpAction();
			expect(action.desc.id).toBe('positronNotebook.addSelectionUp');
			expect(singleKeybinding(action.desc.keybinding)?.primary).toBe(KeyMod.Shift | KeyCode.UpArrow);
			expect(singleKeybinding(action.desc.keybinding)?.secondary).toEqual([KeyMod.Shift | KeyCode.KeyK]);
			expect(singleKeybinding(action.desc.keybinding)?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('calls moveSelectionUp(true) -- grows MultiSelection upward', () => {
			const notebook = createLabelledTestNotebook(3, ctx);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Normal);

			new TestableAddSelectionUpAction().testRun(notebook, unusedAccessor);

			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.MultiSelection);
			expect(getSelectedCells(state)).toEqual([cells[1], cells[2]]);
			expect(getActiveCell(state)).toBe(cells[1]);
		});
	});

	describe('MoveCellUpAction (Alt+ArrowUp)', () => {
		it('declares Alt+ArrowUp keybinding and cell action bar menu entry gated on canMoveUp', () => {
			const action = new MoveCellUpAction();
			expect(action.desc.id).toBe('positronNotebook.cell.moveUp');
			expect(singleKeybinding(action.desc.keybinding)?.primary).toBe(KeyMod.Alt | KeyCode.UpArrow);
			expect(singleKeybinding(action.desc.keybinding)?.when).toBe(NotebookContextKeys.editorFocused);
			// Menu entry: cell action bar submenu, gated on canMoveUp so the
			// item disappears at the first cell where the move would no-op.
			const menu = Array.isArray(action.desc.menu) ? action.desc.menu[0] : action.desc.menu;
			expect(menu?.id).toBe(MenuId.PositronNotebookCellActionBarSubmenu);
			expect(menu?.when).toBe(CellContextKeys.canMoveUp);
		});

		it('moves the selected cell up by one and selection follows', () => {
			const notebook = createLabelledTestNotebook(3, ctx);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Normal);

			new TestableMoveCellUpAction().testRun(notebook, unusedAccessor);

			expect(notebook.cells.get().map(c => c.getContent())).toEqual(['A', 'C', 'B']);
			// Selection follows: same cell ref, now at index 1
			const state = notebook.selectionStateMachine.state.get();
			expect(getActiveCell(state)).toBe(cells[2]);
		});
	});

	describe('MoveCellDownAction (Alt+ArrowDown)', () => {
		it('declares Alt+ArrowDown keybinding and cell action bar menu entry gated on canMoveDown', () => {
			const action = new MoveCellDownAction();
			expect(action.desc.id).toBe('positronNotebook.cell.moveDown');
			expect(singleKeybinding(action.desc.keybinding)?.primary).toBe(KeyMod.Alt | KeyCode.DownArrow);
			expect(singleKeybinding(action.desc.keybinding)?.when).toBe(NotebookContextKeys.editorFocused);
			const menu = Array.isArray(action.desc.menu) ? action.desc.menu[0] : action.desc.menu;
			expect(menu?.id).toBe(MenuId.PositronNotebookCellActionBarSubmenu);
			expect(menu?.when).toBe(CellContextKeys.canMoveDown);
		});

		it('moves the selected cell down by one and selection follows', () => {
			const notebook = createLabelledTestNotebook(3, ctx);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);

			new TestableMoveCellDownAction().testRun(notebook, unusedAccessor);

			expect(notebook.cells.get().map(c => c.getContent())).toEqual(['B', 'A', 'C']);
			const state = notebook.selectionStateMachine.state.get();
			expect(getActiveCell(state)).toBe(cells[0]);
		});
	});
});
