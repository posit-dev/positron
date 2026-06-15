/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingRule, KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { RuntimeNotebookKernel } from '../../../runtimeNotebookKernel/browser/runtimeNotebookKernel.js';
import { IRuntimeNotebookKernelService } from '../../../runtimeNotebookKernel/common/interfaces/runtimeNotebookKernelService.js';
import { CellContextKeys } from '../../common/cellContextKeys.js';
import { NotebookContextKeys } from '../../common/notebookContextKeys.js';
import { SELECT_KERNEL_ID_POSITRON } from '../../common/positronNotebookCommon.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { IPositronNotebookCell } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { SelectionState, SelectionStateMachine } from '../../browser/selectionMachine.js';
import { ExecuteSelectionInCellAction, getSelectedCodeFragment } from '../../browser/ExecuteSelectionInCellAction.js';

describe('getSelectedCodeFragment', () => {
	const disposables = ensureNoLeakedDisposables();

	function createEditor(content: string, selection: Selection): ICodeEditor {
		const model = disposables.add(createTextModel(content, 'python'));
		return stubInterface<ICodeEditor>({
			hasModel: (() => true) as ICodeEditor['hasModel'],
			getModel: () => model,
			getSelection: () => selection,
		});
	}

	it('returns the selected text when there is a non-empty selection', () => {
		const editor = createEditor('1 + 1\nflights', new Selection(2, 1, 2, 8));
		expect(getSelectedCodeFragment(editor)).toBe('flights');
	});

	it('returns a partial selection within a line', () => {
		const editor = createEditor('print(flights)', new Selection(1, 7, 1, 14));
		expect(getSelectedCodeFragment(editor)).toBe('flights');
	});

	it('preserves a multi-line selection exactly', () => {
		const editor = createEditor('x = 1\ny = 2\nprint(x + y)', new Selection(1, 1, 2, 6));
		expect(getSelectedCodeFragment(editor)).toBe('x = 1\ny = 2');
	});

	it('does not trim surrounding whitespace from a selection', () => {
		const editor = createEditor('  x = 1  ', new Selection(1, 1, 1, 10));
		expect(getSelectedCodeFragment(editor)).toBe('  x = 1  ');
	});

	it('returns the cursor line, trimmed, when the selection is empty', () => {
		const editor = createEditor('x = 1\n    y = 2', new Selection(2, 3, 2, 3));
		expect(getSelectedCodeFragment(editor)).toBe('y = 2');
	});

	it('returns undefined when the cursor line is blank', () => {
		const editor = createEditor('x = 1\n\t \ny = 2', new Selection(2, 1, 2, 1));
		expect(getSelectedCodeFragment(editor)).toBeUndefined();
	});

	it('returns undefined when the selection contains only whitespace', () => {
		const editor = createEditor('x = 1\n   \nz = 3', new Selection(2, 1, 2, 4));
		expect(getSelectedCodeFragment(editor)).toBeUndefined();
	});

	it('returns undefined when the editor has no model', () => {
		const editor = stubInterface<ICodeEditor>({
			hasModel: (() => false) as ICodeEditor['hasModel'],
		});
		expect(getSelectedCodeFragment(editor)).toBeUndefined();
	});

	it('returns undefined when the editor has no selection', () => {
		const model = disposables.add(createTextModel('x = 1', 'python'));
		const editor = stubInterface<ICodeEditor>({
			hasModel: (() => true) as ICodeEditor['hasModel'],
			getModel: () => model,
			getSelection: () => null,
		});
		expect(getSelectedCodeFragment(editor)).toBeUndefined();
	});
});

describe('ExecuteSelectionInCellAction', () => {
	const disposables = ensureNoLeakedDisposables();

	const notebookUri = URI.parse('file:///test.ipynb');

	// Expose the protected runNotebookAction so behavior can be tested without
	// standing up an active editor pane (same pattern as selectionKeybindings).
	class TestableExecuteSelectionInCellAction extends ExecuteSelectionInCellAction {
		public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}

	function createEditor(content: string, selection: Selection): ICodeEditor {
		const model = disposables.add(createTextModel(content, 'python'));
		return stubInterface<ICodeEditor>({
			hasModel: (() => true) as ICodeEditor['hasModel'],
			getModel: () => model,
			getSelection: () => selection,
		});
	}

	function createCodeCell(handle: number, editor: ICodeEditor | undefined): IPositronNotebookCell {
		return stubInterface<IPositronNotebookCell>({
			handle,
			currentEditor: editor,
			isCodeCell: (() => true) as IPositronNotebookCell['isCodeCell'],
		});
	}

	function createNotebook(cell: IPositronNotebookCell, options?: { kernelSelected?: boolean }): IPositronNotebookInstance {
		const kernel = options?.kernelSelected === false
			? undefined
			: stubInterface<RuntimeNotebookKernel>({ id: 'test-kernel' });
		return stubInterface<IPositronNotebookInstance>({
			uri: notebookUri,
			kernel: observableValue('kernel', kernel),
			selectionStateMachine: stubInterface<SelectionStateMachine>({
				state: observableValue('state', { type: SelectionState.EditingSelection, active: cell }),
			}),
		});
	}

	function createServices() {
		const executeCodeInCell = vi.fn<(uri: URI, handle: number, code: string) => Promise<void>>()
			.mockResolvedValue(undefined);
		const executeCommand = vi.fn().mockResolvedValue(undefined);
		const notifyError = vi.fn();
		const logError = vi.fn();
		const services = new Map<unknown, unknown>([
			[IRuntimeNotebookKernelService, { executeCodeInCell }],
			[ICommandService, { executeCommand }],
			[INotificationService, { error: notifyError }],
			[ILogService, { error: logError }],
		]);
		const accessor: ServicesAccessor = {
			get: <T>(id: unknown): T => {
				if (!services.has(id)) {
					throw new Error(`Unexpected service requested in test: ${String(id)}`);
				}
				return services.get(id) as T;
			},
		};
		return { accessor, executeCodeInCell, executeCommand, notifyError, logError };
	}

	it('declares the Cmd/Ctrl+Shift+Enter keybinding scoped to focused code cell editors', () => {
		const action = new ExecuteSelectionInCellAction();
		expect(action.desc.id).toBe('positronNotebook.cell.executeSelection');
		// The action declares a single keybinding rule; narrow from OneOrN.
		const keybinding = action.desc.keybinding as Omit<IKeybindingRule, 'id'>;
		expect(keybinding.primary).toBe(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter);
		// WorkbenchContrib so it deterministically wins over the EditorContrib
		// Run All / Stop All bindings on the same key while editing a code cell.
		expect(keybinding.weight).toBe(KeybindingWeight.WorkbenchContrib);
		expect(keybinding.when?.serialize()).toBe(
			ContextKeyExpr.and(NotebookContextKeys.cellEditorFocused, CellContextKeys.isCode)!.serialize()
		);
	});

	it('runs the selected text in the active cell via the kernel service', async () => {
		const editor = createEditor('1 + 1\nflights', new Selection(2, 1, 2, 8));
		const cell = createCodeCell(7, editor);
		const notebook = createNotebook(cell);
		const { accessor, executeCodeInCell, executeCommand } = createServices();

		await new TestableExecuteSelectionInCellAction().testRun(notebook, accessor);

		expect(executeCodeInCell).toHaveBeenCalledOnce();
		expect(executeCodeInCell).toHaveBeenCalledWith(notebookUri, 7, 'flights');
		// A kernel is already selected; no kernel selection prompt.
		expect(executeCommand).not.toHaveBeenCalled();
	});

	it('runs the current line when the selection is empty', async () => {
		const editor = createEditor('x = 1\ny = 2', new Selection(2, 3, 2, 3));
		const cell = createCodeCell(3, editor);
		const notebook = createNotebook(cell);
		const { accessor, executeCodeInCell } = createServices();

		await new TestableExecuteSelectionInCellAction().testRun(notebook, accessor);

		expect(executeCodeInCell).toHaveBeenCalledWith(notebookUri, 3, 'y = 2');
	});

	it('does nothing for a non-code cell', async () => {
		const editor = createEditor('# heading', new Selection(1, 1, 1, 10));
		const cell = stubInterface<IPositronNotebookCell>({
			handle: 1,
			currentEditor: editor,
			isCodeCell: (() => false) as IPositronNotebookCell['isCodeCell'],
		});
		const notebook = createNotebook(cell);
		const { accessor, executeCodeInCell } = createServices();

		await new TestableExecuteSelectionInCellAction().testRun(notebook, accessor);

		expect(executeCodeInCell).not.toHaveBeenCalled();
	});

	it('does nothing when there is nothing runnable at the cursor', async () => {
		const editor = createEditor('x = 1\n\nz = 3', new Selection(2, 1, 2, 1));
		const cell = createCodeCell(2, editor);
		const notebook = createNotebook(cell);
		const { accessor, executeCodeInCell } = createServices();

		await new TestableExecuteSelectionInCellAction().testRun(notebook, accessor);

		expect(executeCodeInCell).not.toHaveBeenCalled();
	});

	it('does nothing when the cell has no attached editor', async () => {
		const cell = createCodeCell(2, undefined);
		const notebook = createNotebook(cell);
		const { accessor, executeCodeInCell } = createServices();

		await new TestableExecuteSelectionInCellAction().testRun(notebook, accessor);

		expect(executeCodeInCell).not.toHaveBeenCalled();
	});

	it('prompts for kernel selection when no kernel is selected', async () => {
		const editor = createEditor('flights', new Selection(1, 1, 1, 8));
		const cell = createCodeCell(5, editor);
		const notebook = createNotebook(cell, { kernelSelected: false });
		const { accessor, executeCodeInCell, executeCommand } = createServices();

		await new TestableExecuteSelectionInCellAction().testRun(notebook, accessor);

		expect(executeCommand).toHaveBeenCalledWith(SELECT_KERNEL_ID_POSITRON);
		expect(executeCommand.mock.invocationCallOrder[0])
			.toBeLessThan(executeCodeInCell.mock.invocationCallOrder[0]);
	});

	it('logs the failure detail but shows a clean message when execution fails', async () => {
		const editor = createEditor('flights', new Selection(1, 1, 1, 8));
		const cell = createCodeCell(5, editor);
		const notebook = createNotebook(cell);
		const { accessor, executeCodeInCell, notifyError, logError } = createServices();
		executeCodeInCell.mockRejectedValue(new Error('no selected kernel: file:///test.ipynb'));

		await new TestableExecuteSelectionInCellAction().testRun(notebook, accessor);

		// The user-facing toast is self-contained and must not leak the raw
		// internal error (URIs, etc.); that detail goes to the log instead.
		expect(notifyError).toHaveBeenCalledOnce();
		expect(notifyError.mock.calls[0][0]).not.toContain('file:///');
		expect(logError).toHaveBeenCalledOnce();
	});
});
