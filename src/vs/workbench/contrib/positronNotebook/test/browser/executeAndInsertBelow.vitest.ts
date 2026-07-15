/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { NotebookContextKeys } from '../../common/notebookContextKeys.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { CellSelectionType, getActiveCell, SelectionState } from '../../browser/selectionMachine.js';
import { ExecuteAndInsertBelowAction } from '../../browser/positronNotebook.contribution.js';
import { createLabelledTestNotebook, createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import { singleKeybinding } from './keybindingTestUtils.js';

/**
 * Verifies the Alt/Option+Enter notebook action (issue #12938): run the active
 * cell and ALWAYS insert a new cell of the same type directly below it, focused
 * in edit mode (Jupyter-style). Each test asserts both halves of the wiring:
 *  - Keybinding metadata: the action declares Alt+Enter scoped to editorFocused.
 *  - Behavior: invoking the action inserts+focuses the new cell and triggers
 *    execution of code cells.
 *
 * Cell execution itself needs a live kernel, so it is out of scope here -- we
 * assert the action calls `cell.run()` (spied) rather than that code actually
 * ran. The full execute-against-a-kernel path is covered by e2e.
 */
describe('ExecuteAndInsertBelowAction (Alt+Enter)', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	// Test-only subclass that exposes the protected `runNotebookAction` so we
	// can invoke action behavior without standing up an active editor pane.
	// Mirrors the pattern in selectionKeybindings.vitest.ts.
	class TestableExecuteAndInsertBelowAction extends ExecuteAndInsertBelowAction {
		public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}

	// runNotebookAction takes a ServicesAccessor that this action never reads.
	// Pass a stub that throws clearly if a future implementation reaches for it.
	const unusedAccessor: ServicesAccessor = {
		get() { throw new Error('ServicesAccessor must not be used in this action test'); },
	};

	// After a cell is inserted, the notebook defers selecting/edit-focusing the
	// new cell to the next macrotask (setTimeout(0) in _syncCells, to let the
	// React cell mount first). Flush one macrotask to observe that focus.
	const flushDeferredFocus = () => new Promise<void>(resolve => setTimeout(resolve, 0));

	it('declares Alt+Enter keybinding scoped to editorFocused', () => {
		const action = new ExecuteAndInsertBelowAction();
		expect(action.desc.id).toBe('positronNotebook.cell.executeAndInsertBelow');
		expect(singleKeybinding(action.desc.keybinding)?.primary).toBe(KeyMod.Alt | KeyCode.Enter);
		expect(singleKeybinding(action.desc.keybinding)?.when).toBe(NotebookContextKeys.editorFocused);
	});

	it('runs a non-last code cell and inserts a focused code cell directly below', async () => {
		const notebook = createLabelledTestNotebook(2, ctx);
		const cells = notebook.cells.get();
		notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
		const runSpy = vi.spyOn(cells[0], 'run').mockImplementation(() => { });

		await new TestableExecuteAndInsertBelowAction().testRun(notebook, unusedAccessor);
		await flushDeferredFocus();

		const after = notebook.cells.get();
		const state = notebook.selectionStateMachine.state.get();
		expect({
			count: after.length,
			newCellKind: after[1].kind,
			activeIsNewCell: getActiveCell(state) === after[1],
			stateType: state.type,
			runCalls: runSpy.mock.calls.length,
		}).toEqual({
			count: 3,
			newCellKind: CellKind.Code,
			activeIsNewCell: true,
			stateType: SelectionState.EditingSelection,
			runCalls: 1,
		});
	});

	it('runs the last code cell and appends a focused code cell below it', async () => {
		const notebook = createLabelledTestNotebook(2, ctx);
		const cells = notebook.cells.get();
		notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Normal);
		const runSpy = vi.spyOn(cells[1], 'run').mockImplementation(() => { });

		await new TestableExecuteAndInsertBelowAction().testRun(notebook, unusedAccessor);
		await flushDeferredFocus();

		const after = notebook.cells.get();
		const state = notebook.selectionStateMachine.state.get();
		expect({
			count: after.length,
			newCellKind: after[2].kind,
			activeIsNewCell: getActiveCell(state) === after[2],
			stateType: state.type,
			runCalls: runSpy.mock.calls.length,
		}).toEqual({
			count: 3,
			newCellKind: CellKind.Code,
			activeIsNewCell: true,
			stateType: SelectionState.EditingSelection,
			runCalls: 1,
		});
	});

	it('inserts a markdown cell below a markdown cell without running it', async () => {
		const notebook = createTestPositronNotebookInstance([
			['# Code', 'python', CellKind.Code],
			['## Markdown', 'markdown', CellKind.Markup],
		], ctx);
		const cells = notebook.cells.get();
		notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Normal);
		const runSpy = vi.spyOn(cells[1], 'run').mockImplementation(() => { });

		await new TestableExecuteAndInsertBelowAction().testRun(notebook, unusedAccessor);

		const after = notebook.cells.get();
		expect({
			count: after.length,
			newCellKind: after[2].kind,
			runCalls: runSpy.mock.calls.length,
		}).toEqual({
			count: 3,
			newCellKind: CellKind.Markup,
			runCalls: 0,
		});
	});

	it('is a no-op when there is no active cell', async () => {
		const notebook = createTestPositronNotebookInstance([], ctx);
		expect(notebook.selectionStateMachine.state.get().type).toBe(SelectionState.NoCells);

		await new TestableExecuteAndInsertBelowAction().testRun(notebook, unusedAccessor);

		expect(notebook.cells.get().length).toBe(0);
	});
});
