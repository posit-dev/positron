/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellSelectionType, SelectionState } from '../../browser/selectionMachine.js';
import {
	POSITRON_NOTEBOOK_COMMAND_MODE,
	ReduceSelectionToActiveCellAction,
	SelectDownAction,
	SelectUpAction,
} from '../../browser/positronNotebook.contribution.js';
import { createLabelledTestNotebook } from './testPositronNotebookInstance.js';

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

	// runNotebookAction takes a ServicesAccessor that these actions never read.
	// Pass a sentinel so any accidental .get() call would fail loudly.
	const unusedAccessor = undefined as unknown as ServicesAccessor;

	describe('SelectUpAction (ArrowUp / K)', () => {
		it('declares ArrowUp keybinding scoped to command mode', () => {
			const action = new SelectUpAction();
			expect(action.desc.id).toBe('positronNotebook.selectUp');
			expect(action.desc.keybinding?.primary).toBe(KeyCode.UpArrow);
			expect(action.desc.keybinding?.secondary).toEqual([KeyCode.KeyK]);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('calls moveSelectionUp(false) on the active notebook', () => {
			const notebook = createLabelledTestNotebook(3, ctx);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Normal);

			new SelectUpAction().runNotebookAction(notebook, unusedAccessor);

			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(state.type === SelectionState.SingleSelection && state.active).toBe(cells[1]);
		});
	});

	describe('SelectDownAction (ArrowDown / J)', () => {
		it('declares ArrowDown keybinding scoped to command mode', () => {
			const action = new SelectDownAction();
			expect(action.desc.id).toBe('positronNotebook.selectDown');
			expect(action.desc.keybinding?.primary).toBe(KeyCode.DownArrow);
			expect(action.desc.keybinding?.secondary).toEqual([KeyCode.KeyJ]);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('calls moveSelectionDown(false) on the active notebook', () => {
			const notebook = createLabelledTestNotebook(3, ctx);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);

			new SelectDownAction().runNotebookAction(notebook, unusedAccessor);

			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(state.type === SelectionState.SingleSelection && state.active).toBe(cells[1]);
		});
	});

	describe('ReduceSelectionToActiveCellAction (Escape)', () => {
		it('declares Escape keybinding scoped to command mode', () => {
			const action = new ReduceSelectionToActiveCellAction();
			expect(action.desc.id).toBe('positronNotebook.reduceSelectionToActiveCell');
			expect(action.desc.keybinding?.primary).toBe(KeyCode.Escape);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('collapses MultiSelection to SingleSelection on the active cell', () => {
			const notebook = createLabelledTestNotebook(3, ctx);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);
			notebook.selectionStateMachine.selectCell(cells[2], CellSelectionType.Add);

			new ReduceSelectionToActiveCellAction().runNotebookAction(notebook, unusedAccessor);

			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(state.type === SelectionState.SingleSelection && state.active).toBe(cells[2]);
		});

		it('is a no-op in SingleSelection', () => {
			const notebook = createLabelledTestNotebook(3, ctx);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Normal);

			new ReduceSelectionToActiveCellAction().runNotebookAction(notebook, unusedAccessor);

			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			expect(state.type === SelectionState.SingleSelection && state.active).toBe(cells[1]);
		});
	});
});
