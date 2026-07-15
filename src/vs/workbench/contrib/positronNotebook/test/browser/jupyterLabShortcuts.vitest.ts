/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { KeyChord, KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { NotebookContextKeys } from '../../common/notebookContextKeys.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { IPositronNotebookCell } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import {
	ClearAllOutputsAction,
	EnterEditModeAction,
	ExecuteAndInsertBelowAction,
	ExecuteAndSelectBelowAction,
	ExecuteOrToggleEditorAction,
	ExitEditModeAction,
	InterruptKernelAction,
	MoveCellDownAction,
	MoveCellUpAction,
	POSITRON_NOTEBOOK_COMMAND_MODE,
	RunAllCellsAction,
	SelectAllCellsAction,
	ToggleLineNumbersAction,
	ToggleOutputAction,
	ToggleOutputScrollAction,
} from '../../browser/positronNotebook.contribution.js';
import { CellSelectionType, getSelectedCells, SelectionState, SelectionStateMachine } from '../../browser/selectionMachine.js';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';

/**
 * Tests for all Positron Notebook keyboard shortcuts.
 *
 * Each shortcut is tested for:
 * 1. Keybinding metadata (correct key, correct `when` context)
 * 2. Action behavior (invoking produces the right state change)
 */
describe('Positron Notebook keyboard shortcuts', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	// Testable subclasses that expose the protected `runNotebookAction`.
	class TestableExecuteOrToggleEditor extends ExecuteOrToggleEditorAction {
		testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}
	class TestableExecuteAndSelectBelow extends ExecuteAndSelectBelowAction {
		testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}
	class TestableExecuteAndInsertBelow extends ExecuteAndInsertBelowAction {
		testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}
	class TestableEnterEditMode extends EnterEditModeAction {
		testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}
	class TestableExitEditMode extends ExitEditModeAction {
		testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}
	class TestableToggleLineNumbers extends ToggleLineNumbersAction {
		testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}
	class TestableRunAllCells extends RunAllCellsAction {
		testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}
	class TestableClearAllOutputs extends ClearAllOutputsAction {
		testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}

	const unusedAccessor: ServicesAccessor = {
		get() { throw new Error('ServicesAccessor must not be used'); },
	};

	//#region Execution shortcuts

	describe('Ctrl+Enter (Execute Cell or Toggle Editor)', () => {
		it('declares Cmd+Enter scoped to notebook editor focused', () => {
			const action = new ExecuteOrToggleEditorAction();
			expect(action.desc.keybinding?.primary).toBe(KeyMod.CtrlCmd | KeyCode.Enter);
			expect(action.desc.keybinding?.when).toBe(NotebookContextKeys.editorFocused);
		});

		it('calls run() on active code cell', () => {
			const run = vi.fn();
			const cell = stubInterface<IPositronNotebookCell>({
				isMarkdownCell: () => false,
				isCodeCell: () => true,
				run,
			});
			const notebook = stubInterface<IPositronNotebookInstance>({
				selectionStateMachine: {
					state: observableValue('state', { type: SelectionState.SingleSelection, active: cell }),
				} as unknown as SelectionStateMachine,
			});

			new TestableExecuteOrToggleEditor().testRun(notebook, unusedAccessor);

			expect(run).toHaveBeenCalledOnce();
		});

		it('calls toggleEditor() on active markdown cell', () => {
			const toggleEditor = vi.fn();
			const cell = stubInterface<IPositronNotebookCell>({
				isMarkdownCell: () => true,
				isCodeCell: () => false,
				toggleEditor,
			});
			const notebook = stubInterface<IPositronNotebookInstance>({
				selectionStateMachine: {
					state: observableValue('state', { type: SelectionState.SingleSelection, active: cell }),
				} as unknown as SelectionStateMachine,
			});

			new TestableExecuteOrToggleEditor().testRun(notebook, unusedAccessor);

			expect(toggleEditor).toHaveBeenCalledOnce();
		});
	});

	describe('Shift+Enter (Execute Cell and Select Below)', () => {
		it('declares Shift+Enter scoped to notebook editor focused', () => {
			const action = new ExecuteAndSelectBelowAction();
			expect(action.desc.keybinding?.primary).toBe(KeyMod.Shift | KeyCode.Enter);
			expect(action.desc.keybinding?.when).toBe(NotebookContextKeys.editorFocused);
		});

		it('runs cell and moves selection down', async () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['cell1', 'python', CellKind.Code],
					['cell2', 'python', CellKind.Code],
				],
				ctx,
			);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			// Spy to prevent actual execution reaching the test execution service
			const runSpy = vi.spyOn(cells[0], 'run').mockImplementation(() => { });

			await new TestableExecuteAndSelectBelow().testRun(notebook, unusedAccessor);

			expect(runSpy).toHaveBeenCalledOnce();
			const state = notebook.selectionStateMachine.state.get();
			expect(state.type).toBe(SelectionState.SingleSelection);
			if (state.type === SelectionState.SingleSelection) {
				expect(state.active.getContent()).toBe('cell2');
			}
		});

		it('inserts new cell when on last cell', async () => {
			const notebook = createTestPositronNotebookInstance(
				[['only', 'python', CellKind.Code]],
				ctx,
			);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			vi.spyOn(cells[0], 'run').mockImplementation(() => { });

			await new TestableExecuteAndSelectBelow().testRun(notebook, unusedAccessor);

			expect(notebook.cells.get()).toHaveLength(2);
		});
	});

	describe('Alt+Enter (Execute Cell and Insert Below)', () => {
		it('declares Alt+Enter scoped to notebook editor focused', () => {
			const action = new ExecuteAndInsertBelowAction();
			expect(action.desc.keybinding?.primary).toBe(KeyMod.Alt | KeyCode.Enter);
			expect(action.desc.keybinding?.when).toBe(NotebookContextKeys.editorFocused);
		});

		it('runs cell and inserts a new cell below', async () => {
			const notebook = createTestPositronNotebookInstance(
				[
					['cell1', 'python', CellKind.Code],
					['cell2', 'python', CellKind.Code],
				],
				ctx,
			);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			const runSpy = vi.spyOn(cells[0], 'run').mockImplementation(() => { });

			await new TestableExecuteAndInsertBelow().testRun(notebook, unusedAccessor);

			expect(runSpy).toHaveBeenCalledOnce();
			expect(notebook.cells.get()).toHaveLength(3);
		});
	});

	describe('Ctrl+Shift+Enter (Run All Cells)', () => {
		it('declares Ctrl+Shift+Enter', () => {
			const action = new RunAllCellsAction();
			expect(action.desc.keybinding?.primary).toBe(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter);
		});

		it('calls runAllCells() on the notebook', () => {
			const runAllCells = vi.fn();
			const notebook = stubInterface<IPositronNotebookInstance>({ runAllCells });

			new TestableRunAllCells().testRun(notebook, unusedAccessor);

			expect(runAllCells).toHaveBeenCalledOnce();
		});
	});

	//#endregion

	//#region Mode switching

	describe('Enter (Enter Edit Mode)', () => {
		it('declares Enter scoped to command mode', () => {
			const action = new EnterEditModeAction();
			expect(action.desc.keybinding?.primary).toBe(KeyCode.Enter);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('calls enterEditor on the selection state machine', () => {
			const enterEditor = vi.fn().mockResolvedValue(undefined);
			const notebook = stubInterface<IPositronNotebookInstance>({
				getFocusedCell: () => undefined,
				selectionStateMachine: { enterEditor } as unknown as SelectionStateMachine,
			});

			new TestableEnterEditMode().testRun(notebook, unusedAccessor);

			expect(enterEditor).toHaveBeenCalledOnce();
		});
	});

	describe('Escape (Exit Edit Mode)', () => {
		it('declares Escape scoped to cell editor focused', () => {
			const action = new ExitEditModeAction();
			expect(action.desc.keybinding?.primary).toBe(KeyCode.Escape);
			// `when` is a composite ContextKeyExpr.and(...), so check it includes the cell-editor key.
			expect(action.desc.keybinding?.when?.keys()).toContain(NotebookContextKeys.cellEditorFocused.key);
		});

		it('calls exitEditor when in editing state for code cell', () => {
			const cell = stubInterface<IPositronNotebookCell>({
				isMarkdownCell: () => false,
			});
			const exitEditor = vi.fn();
			const notebook = stubInterface<IPositronNotebookInstance>({
				selectionStateMachine: {
					state: observableValue('state', { type: SelectionState.EditingSelection, active: cell }),
					exitEditor,
				} as unknown as SelectionStateMachine,
			});

			new TestableExitEditMode().testRun(notebook, unusedAccessor);

			expect(exitEditor).toHaveBeenCalledOnce();
		});
	});

	//#endregion

	//#region Cell movement

	describe('Alt+Up / Ctrl+Shift+Up (Move Cell Up)', () => {
		it('declares Alt+Up primary and Ctrl+Shift+Up secondary', () => {
			const action = new MoveCellUpAction();
			expect(action.desc.keybinding?.primary).toBe(KeyMod.Alt | KeyCode.UpArrow);
			expect(action.desc.keybinding?.secondary).toEqual([KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.UpArrow, KeyMod.WinCtrl | KeyMod.Shift | KeyCode.UpArrow]);
			expect(action.desc.keybinding?.when).toBe(NotebookContextKeys.editorFocused);
		});
	});

	describe('Alt+Down / Ctrl+Shift+Down (Move Cell Down)', () => {
		it('declares Alt+Down primary and Ctrl+Shift+Down secondary', () => {
			const action = new MoveCellDownAction();
			expect(action.desc.keybinding?.primary).toBe(KeyMod.Alt | KeyCode.DownArrow);
			expect(action.desc.keybinding?.secondary).toEqual([KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.DownArrow, KeyMod.WinCtrl | KeyMod.Shift | KeyCode.DownArrow]);
			expect(action.desc.keybinding?.when).toBe(NotebookContextKeys.editorFocused);
		});
	});

	//#endregion

	//#region Heading levels

	describe('1-6 (Change to Heading Level)', () => {
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

		it('preserves lines after the first', () => {
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
				expect(after[0].getContent()).toBe('#'.repeat(level) + ' text');
			}
		});
	});

	//#endregion

	//#region Toggle line numbers

	describe('Shift+L (Toggle Line Numbers)', () => {
		it('declares Shift+L scoped to command mode', () => {
			const action = new ToggleLineNumbersAction();
			expect(action.desc.keybinding?.primary).toBe(KeyMod.Shift | KeyCode.KeyL);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('toggles notebook.lineNumbers from off to on', () => {
			const notebook = createTestPositronNotebookInstance(
				[['cell', 'python', CellKind.Code]],
				ctx,
			);
			const configService = ctx.instantiationService.get(IConfigurationService);
			vi.spyOn(configService, 'getValue').mockReturnValue('off');
			const updateSpy = vi.spyOn(configService, 'updateValue').mockResolvedValue(undefined);

			new TestableToggleLineNumbers().testRun(notebook, ctx.instantiationService);

			expect(updateSpy).toHaveBeenCalledWith('notebook.lineNumbers', 'on');
		});

		it('toggles notebook.lineNumbers from on to off', () => {
			const notebook = createTestPositronNotebookInstance(
				[['cell', 'python', CellKind.Code]],
				ctx,
			);
			const configService = ctx.instantiationService.get(IConfigurationService);
			vi.spyOn(configService, 'getValue').mockReturnValue('on');
			const updateSpy = vi.spyOn(configService, 'updateValue').mockResolvedValue(undefined);

			new TestableToggleLineNumbers().testRun(notebook, ctx.instantiationService);

			expect(updateSpy).toHaveBeenCalledWith('notebook.lineNumbers', 'off');
		});
	});

	//#endregion

	//#region Output toggle

	describe('O (Toggle Cell Output)', () => {
		it('declares O scoped to command mode', () => {
			const action = new ToggleOutputAction();
			expect(action.desc.keybinding?.primary).toBe(KeyCode.KeyO);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

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
				expect(cell.outputIsCollapsed.get()).toBe(false);
				cell.toggleOutputCollapse();
				expect(cell.outputIsCollapsed.get()).toBe(true);
				cell.toggleOutputCollapse();
				expect(cell.outputIsCollapsed.get()).toBe(false);
			}
		});
	});

	describe('Shift+O (Toggle Cell Output Scrolling)', () => {
		it('declares Shift+O scoped to command mode', () => {
			const action = new ToggleOutputScrollAction();
			expect(action.desc.keybinding?.primary).toBe(KeyMod.Shift | KeyCode.KeyO);
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('toggles output scrolling on a code cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]],
				ctx,
			);
			const cells = notebook.cells.get();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			const cell = cells[0];

			expect(cell.isCodeCell()).toBe(true);
			if (cell.isCodeCell()) {
				// Starts as undefined (follows the global notebook.outputScrolling setting).
				expect(cell.outputScrolling.get()).toBe(undefined);
				// First toggle resolves the effective state and sets the explicit opposite.
				cell.toggleOutputScroll();
				const first = cell.outputScrolling.get();
				expect(typeof first).toBe('boolean');
				// Subsequent toggles flip the explicit value.
				cell.toggleOutputScroll();
				expect(cell.outputScrolling.get()).toBe(!first);
			}
		});
	});

	//#endregion

	//#region Select all

	describe('Cmd+A (Select All Cells)', () => {
		it('declares Cmd+A scoped to command mode', () => {
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

	//#endregion

	//#region Interrupt kernel

	describe('I+I (Interrupt Kernel)', () => {
		it('declares I,I chord scoped to command mode', () => {
			const action = new InterruptKernelAction();
			expect(action.desc.keybinding?.primary).toBe(KeyChord(KeyCode.KeyI, KeyCode.KeyI));
			expect(action.desc.keybinding?.when).toBe(POSITRON_NOTEBOOK_COMMAND_MODE);
		});

		it('calls interruptKernel() on the notebook', () => {
			const interruptKernel = vi.fn();
			const notebook = stubInterface<IPositronNotebookInstance>({ interruptKernel });

			new (class extends InterruptKernelAction {
				testRun(nb: IPositronNotebookInstance, accessor: ServicesAccessor) {
					return this.runNotebookAction(nb, accessor);
				}
			})().testRun(notebook, unusedAccessor);

			expect(interruptKernel).toHaveBeenCalledOnce();
		});

		it('does not throw when no cells are executing', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]],
				ctx,
			);
			expect(() => notebook.interruptKernel()).not.toThrow();
		});
	});

	//#endregion

	//#region Clear all outputs

	describe('Ctrl+K, K (Clear All Outputs)', () => {
		it('declares Ctrl+K,K chord keybinding', () => {
			const action = new ClearAllOutputsAction();
			expect(action.desc.keybinding?.primary).toBe(KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyK));
		});

		it('calls clearAllCellOutputs() on the notebook', () => {
			const clearAllCellOutputs = vi.fn();
			const notebook = stubInterface<IPositronNotebookInstance>({ clearAllCellOutputs });

			new TestableClearAllOutputs().testRun(notebook, unusedAccessor);

			expect(clearAllCellOutputs).toHaveBeenCalledOnce();
		});
	});

	//#endregion
});
