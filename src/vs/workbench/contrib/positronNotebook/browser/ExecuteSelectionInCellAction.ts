/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { localize, localize2 } from '../../../../nls.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IRuntimeNotebookKernelService } from '../../runtimeNotebookKernel/common/interfaces/runtimeNotebookKernelService.js';
import { CellContextKeys } from '../common/cellContextKeys.js';
import { NotebookContextKeys } from '../common/notebookContextKeys.js';
import { PositronNotebookCellActionGroup, SELECT_KERNEL_ID_POSITRON } from '../common/positronNotebookCommon.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { NotebookAction2 } from './NotebookAction2.js';
import { getActiveCell } from './selectionMachine.js';

/**
 * Get the code to execute from a cell editor: the selected text, or the
 * cursor's line (trimmed) when the selection is empty. Returns undefined when
 * there is nothing runnable.
 *
 * A non-empty selection is returned exactly as highlighted (no trimming), for
 * parity with ExecuteSelectionInConsoleAction. The current line is trimmed so
 * that an indented line runs on its own (e.g. in Python).
 */
export function getSelectedCodeFragment(editor: ICodeEditor): string | undefined {
	if (!editor.hasModel()) {
		return undefined;
	}

	const selection = editor.getSelection();
	if (!selection) {
		return undefined;
	}

	const model = editor.getModel();
	const code = selection.isEmpty()
		// No selection: run the entire line the cursor is on, trimmed so that
		// an indented line (e.g. inside a Python block) runs on its own.
		? model.getLineContent(selection.getStartPosition().lineNumber).trim()
		: model.getValueInRange(selection);
	return code.trim() ? code : undefined;
}

/**
 * An action that executes the selected text in a notebook code cell (or the
 * cursor's line when nothing is selected) in the notebook's kernel, with the
 * output shown on that cell.
 */
export class ExecuteSelectionInCellAction extends NotebookAction2 {
	constructor() {
		super({
			id: 'positronNotebook.cell.executeSelection',
			title: localize2('positronNotebook.cell.executeSelection', "Run Selection in Cell"),
			category: localize2('positronNotebook.category', 'Notebook'),
			f1: true,
			precondition: NotebookContextKeys.cellEditorFocused,
			// Keep focus in the cell editor so the user can keep stepping
			// through lines.
			grabFocusOnRun: false,
			keybinding: {
				// Run All / Stop All bind the same key at EditorContrib weight
				// for the whole notebook editor. WorkbenchContrib makes this
				// binding deterministically win while a code cell editor is
				// focused (Colab-style: Ctrl/Cmd+Shift+Enter runs the selection).
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter,
				when: ContextKeyExpr.and(
					NotebookContextKeys.cellEditorFocused,
					CellContextKeys.isCode,
				),
			},
			menu: [{
				id: MenuId.PositronNotebookCellContext,
				group: PositronNotebookCellActionGroup.Execution,
				order: 30,
				when: ContextKeyExpr.and(
					NotebookContextKeys.cellEditorFocused,
					CellContextKeys.isCode,
				),
			}],
		});
	}

	protected override async runNotebookAction(notebook: IPositronNotebookInstance, accessor: ServicesAccessor): Promise<void> {
		// The accessor is only valid synchronously; get services up front.
		const commandService = accessor.get(ICommandService);
		const runtimeNotebookKernelService = accessor.get(IRuntimeNotebookKernelService);
		const notificationService = accessor.get(INotificationService);
		const logService = accessor.get(ILogService);

		const cell = getActiveCell(notebook.selectionStateMachine.state.get());
		if (!cell?.isCodeCell()) {
			return;
		}

		const editor = cell.currentEditor;
		if (!editor) {
			return;
		}

		const code = getSelectedCodeFragment(editor);
		if (code === undefined) {
			return;
		}

		// Make sure a kernel is selected before executing, prompting the user
		// if needed (mirrors PositronNotebookInstance._runCells).
		if (!notebook.kernel.get()) {
			await commandService.executeCommand(SELECT_KERNEL_ID_POSITRON);
		}

		try {
			await runtimeNotebookKernelService.executeCodeInCell(notebook.uri, cell.handle, code);
		} catch (err) {
			// The underlying error messages carry internal detail (URIs, etc.)
			// that isn't useful to the user; log them and show a clean message.
			logService.error(`Run Selection in Cell failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
			notificationService.error(localize(
				'positron.notebook.executeSelection.failed',
				"Could not run the selected code."
			));
		}
	}
}
