/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { CELL_TITLE_CELL_GROUP_ID, CellToolbarOrder, getContextFromActiveEditor } from '../../notebook/browser/controller/coreActions.js';
import { executeIcon } from '../../notebook/browser/notebookIcons.js';
import { NOTEBOOK_EDITOR_ID } from '../../notebook/common/notebookCommon.js';
import { CodeAttributionSource } from '../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { RuntimeCodeExecutionMode } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';
import { NOTEBOOK_CELL_TYPE } from '../../notebook/common/notebookContextKeys.js';

export const SELECT_KERNEL_ID_POSITRON = 'positronNotebook.selectKernel';

/**
 * An action that executes the selected text in a notebook cell in the
 * associated console for the notebook.
 */
export class ExecuteSelectionInConsoleAction extends Action2 {

	constructor() {
		super({
			id: 'positronNotebook.executeSelectionInConsole',
			category: localize2('notebook.category', 'Notebook'),
			title: localize2('positronNotebookActions.executeSelectionInConsole', 'Execute Selection in Console'),
			icon: executeIcon,
			f1: true,
			// Only enable if the active editor is a notebook (Positron or built-in)
			precondition: ContextKeyExpr.or(
				ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
				ContextKeyExpr.equals('activeEditor', NOTEBOOK_EDITOR_ID),
			),
			// Show in the cell context menu, but only for code cells and when there's a selection
			menu: [
				{
					id: MenuId.NotebookCellTitle,
					// We intentionally re-use the "Execute Cell and Below"
					// order so that this appears next to it in the menu w/o us
					// needing to reorder any menus from upstream
					order: CellToolbarOrder.ExecuteCellAndBelow,
					group: CELL_TITLE_CELL_GROUP_ID,
					when: ContextKeyExpr.and(
						NOTEBOOK_CELL_TYPE.isEqualTo('code'),
						EditorContextKeys.hasNonEmptySelection
					),
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<boolean> {
		// Get services
		const positronConsoleService = accessor.get(IPositronConsoleService);
		const editorService = accessor.get(IEditorService);
		const runtimeSessionService = accessor.get(IRuntimeSessionService);
		const logService = accessor.get(ILogService);
		const notificationService = accessor.get(INotificationService);

		// Figure out the URI of the active notebook
		const context = getContextFromActiveEditor(editorService);
		if (!context) {
			// This should never happen because of the precondition on the
			// action, but log if it does
			logService.warn('No active notebook editor found when trying to execute selection in console');
			return false;
		}
		const notebookUri = context.notebookEditor.textModel.uri;

		// Look up the session for the notebook
		const session = runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		if (!session) {
			// Just warn and return if there's no session; this should be rare.
			// If we wanted to be nicer here, we could try to orchestrate an
			// auto-start.
			notificationService.warn(localize('positron.noNotebookSession', "Cannot execute selection; no interpreter session is running for notebook {0}", notebookUri.toString()));
			return false;
		}

		// Show (and possibly create) the console for the notebook
		positronConsoleService.showNotebookConsole(notebookUri, false /*focus*/);

		// Figure out the selected text, or the entire line if no selection
		const selectedText = this.getSelectedText(editorService);
		if (!selectedText) {
			// It's weird to run this with nothing selected and no active line,
			// but just log and return
			logService.warn('Execute Selection in Console: No text selected and no active line found');
			return false;
		}

		// Ask the console service to execute the text
		positronConsoleService.executeCode(
			session.runtimeMetadata.languageId,
			session.sessionId,
			selectedText,
			{ source: CodeAttributionSource.Interactive },
			false, // focus
			true, // allow incomplete
			RuntimeCodeExecutionMode.Interactive
		);
		return true;
	}

	/**
	 * Gets the selected text from the active editor, or the entire line if no selection
	 */
	private getSelectedText(editorService: IEditorService): string | null {
		const editor = editorService.activeTextEditorControl;
		if (!editor) {
			return null;
		}

		// Ensure we have a code editor with a model
		if (!isCodeEditor(editor) || !editor.hasModel()) {
			return null;
		}

		const selection = editor.getSelection();
		if (!selection) {
			return null;
		}

		const model = editor.getModel();

		// If there's a selection, get the selected text
		if (!selection.isEmpty()) {
			return model.getValueInRange(selection);
		} else {
			// No selection - get the entire line where the cursor is
			const position = selection.getStartPosition();
			const lineContent = model.getLineContent(position.lineNumber);
			return lineContent.trim() || null;
		}
	}
}

