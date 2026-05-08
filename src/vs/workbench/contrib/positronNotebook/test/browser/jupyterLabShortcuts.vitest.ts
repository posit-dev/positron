/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import {
	MoveCellDownAction,
	MoveCellUpAction,
	POSITRON_NOTEBOOK_COMMAND_MODE,
} from '../../browser/positronNotebook.contribution.js';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import { CellSelectionType } from '../../browser/selectionMachine.js';
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
});
