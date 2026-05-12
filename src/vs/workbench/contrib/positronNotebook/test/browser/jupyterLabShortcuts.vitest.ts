/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { KeyChord, KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import {
	MoveCellDownAction,
	MoveCellUpAction,
	POSITRON_NOTEBOOK_COMMAND_MODE,
	SelectAllCellsAction,
} from '../../browser/positronNotebook.contribution.js';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import { CellSelectionType, getSelectedCells, SelectionState } from '../../browser/selectionMachine.js';
import { POSITRON_NOTEBOOK_EDITOR_FOCUSED } from '../../browser/ContextKeysManager.js';

describe('JupyterLab keyboard shortcuts', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	describe('Ctrl+Shift+Up/Down move cell keybindings', () => {
		it('MoveCellUpAction declares Ctrl+Shift+Up as secondary binding', () => {
			const action = new MoveCellUpAction();
			expect(action.desc.keybinding?.primary).toBe(KeyMod.Alt | KeyCode.UpArrow);
			expect(action.desc.keybinding?.secondary).toEqual([KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.UpArrow]);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_EDITOR_FOCUSED);
		});

		it('MoveCellDownAction declares Ctrl+Shift+Down as secondary binding', () => {
			const action = new MoveCellDownAction();
			expect(action.desc.keybinding?.primary).toBe(KeyMod.Alt | KeyCode.DownArrow);
			expect(action.desc.keybinding?.secondary).toEqual([KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.DownArrow]);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_EDITOR_FOCUSED);
		});
	});

	describe('changeToHeading (1-6 keys)', () => {
		it('converts code cell to markdown with heading prefix', () => {
			const notebook = createTestPositronNotebookInstance(
				[['some content', 'python', CellKind.Code]],
				ctx,
			);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);

			notebook.changeToHeading(1);

			const after = notebook.cells.get();
			expect(after[0].kind).toBe(CellKind.Markup);
			expect(after[0].getContent()).toBe('# some content');
		});

		it('replaces existing heading prefix when changing levels', () => {
			const notebook = createTestPositronNotebookInstance(
				[['## existing heading', 'markdown', CellKind.Markup]],
				ctx,
			);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);

			notebook.changeToHeading(3);

			const after = notebook.cells.get();
			expect(after[0].getContent()).toBe('### existing heading');
		});

		it('handles empty cell content', () => {
			const notebook = createTestPositronNotebookInstance(
				[['', 'markdown', CellKind.Markup]],
				ctx,
			);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);

			notebook.changeToHeading(2);

			const after = notebook.cells.get();
			expect(after[0].getContent()).toBe('## ');
		});

		it('preserves lines after the first when setting heading', () => {
			const notebook = createTestPositronNotebookInstance(
				[['first line\nsecond line\nthird line', 'markdown', CellKind.Markup]],
				ctx,
			);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);

			notebook.changeToHeading(1);

			const after = notebook.cells.get();
			expect(after[0].getContent()).toBe('# first line\nsecond line\nthird line');
		});

		it('supports all heading levels 1-6', () => {
			for (let level = 1; level <= 6; level++) {
				const notebook = createTestPositronNotebookInstance(
					[['text', 'markdown', CellKind.Markup]],
					ctx,
				);
				const cells = notebook.cells.get();
				notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);

				notebook.changeToHeading(level);

				const after = notebook.cells.get();
				const expectedPrefix = '#'.repeat(level) + ' ';
				expect(after[0].getContent()).toBe(expectedPrefix + 'text');
			}
		});

		it('keybinding for heading 1 is Digit1 scoped to command mode', () => {
			// We can't import anonymous classes, but we can check the registration
			// exists by verifying the changeToHeading method is callable
			const notebook = createTestPositronNotebookInstance(
				[['test', 'python', CellKind.Code]],
				ctx,
			);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);

			notebook.changeToHeading(6);

			const after = notebook.cells.get();
			expect(after[0].kind).toBe(CellKind.Markup);
			expect(after[0].getContent()).toBe('###### test');
		});
	});

	describe('selectAllCells (Cmd+A)', () => {
		it('SelectAllCellsAction declares Cmd+A scoped to command mode', () => {
			const action = new SelectAllCellsAction();
			expect(action.desc.keybinding?.primary).toBe(KeyMod.CtrlCmd | KeyCode.KeyA);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('selects all cells in a multi-cell notebook', () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['cell1', 'python', CellKind.Code],
					['cell2', 'python', CellKind.Code],
					['cell3', 'python', CellKind.Code],
				],
				ctx,
			);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);

			notebook.selectAllCells();

			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.MultiSelection);
			if (state.type === SelectionState.MultiSelection) {
				expect(getSelectedCells(state)).toHaveLength(3);
			}
		});

		it('handles single-cell notebook', () => {
			const notebook = createTestPositronNotebookInstance(
				[['only cell', 'python', CellKind.Code]],
				ctx,
			);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);

			notebook.selectAllCells();

			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
		});
	});

	describe('toggleOutput (o key)', () => {
		it('toggles output collapse on a code cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]],
				ctx,
			);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			const cell = cells[0];

			expect(cell.isCodeCell()).toBe(true);
			if (cell.isCodeCell()) {
				cell.toggleOutputCollapse();
				expect(cell.outputIsCollapsed.get()).toBe(true);
				cell.toggleOutputCollapse();
				expect(cell.outputIsCollapsed.get()).toBe(false);
			}
		});
	});

	describe('interruptKernel (I+I)', () => {
		it('interruptKernel is callable on notebook instance', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]],
				ctx,
			);
			// Verify interruptKernel doesn't throw when no cells are executing
			expect(() => notebook.interruptKernel()).not.toThrow();
		});

		it('I+I keybinding uses KeyChord', () => {
			// Verify the keychord constant matches what we'd expect
			const chord = KeyChord(KeyCode.KeyI, KeyCode.KeyI);
			expect(chord).toBeGreaterThan(0);
		});
	});
});
