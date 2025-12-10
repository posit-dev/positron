/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../../../base/common/keyCodes.js';
import { ICodeEditor } from '../../../../../../editor/browser/editorBrowser.js';
import { EditorContextKeys } from '../../../../../../editor/common/editorContextKeys.js';
import { NextMatchFindAction, PreviousMatchFindAction, StartFindAction } from '../../../../../../editor/contrib/find/browser/findController.js';
import { CONTEXT_FIND_WIDGET_VISIBLE } from '../../../../../../editor/contrib/find/browser/findModel.js';
import { localize2 } from '../../../../../../nls.js';
import { registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED } from '../../ContextKeysManager.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { NotebookAction2 } from '../../NotebookAction2.js';
import { getNotebookInstanceFromActiveEditorPane } from '../../notebookUtils.js';
import { PositronNotebookFindController } from './controller.js';

abstract class PositronNotebookFindAction extends NotebookAction2 {
	override async runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor): Promise<void> {
		const controller = PositronNotebookFindController.get(notebook);
		if (controller) {
			await this.runFindAction(controller);
		}
	}

	abstract runFindAction(controller: PositronNotebookFindController): Promise<void>;
}

registerAction2(class extends PositronNotebookFindAction {
	constructor() {
		super({
			id: 'positron.notebook.find',
			title: localize2('positron.notebook.find.title', 'Find in Notebook'),
			keybinding: {
				when: ContextKeyExpr.and(
					POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
					// ContextKeyExpr.or(NOTEBOOK_IS_ACTIVE_EDITOR, INTERACTIVE_WINDOW_IS_ACTIVE_EDITOR),
					EditorContextKeys.focus.toNegated()
				),
				primary: KeyCode.KeyF | KeyMod.CtrlCmd,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	override async runFindAction(controller: PositronNotebookFindController): Promise<void> {
		controller.start();
	}
});

registerAction2(class extends PositronNotebookFindAction {
	constructor() {
		super({
			id: 'positron.notebook.hideFind',
			title: localize2('positron.notebook.hideFind.title', 'Hide Find in Notebook'),
			keybinding: {
				when: ContextKeyExpr.and(
					POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
					CONTEXT_FIND_WIDGET_VISIBLE,
				),
				primary: KeyCode.Escape,
				weight: KeybindingWeight.EditorContrib + 5
			}
		});
	}

	override async runFindAction(controller: PositronNotebookFindController): Promise<void> {
		controller.closeWidget();
	}
});

NextMatchFindAction.addImplementation(0, (accessor: ServicesAccessor, _codeEditor: ICodeEditor, _args: unknown) => {
	const editorService = accessor.get(IEditorService);
	const notebook = getNotebookInstanceFromActiveEditorPane(editorService);
	if (!notebook) {
		return false;
	}

	const controller = PositronNotebookFindController.get(notebook);
	if (!controller) {
		return false;
	}

	controller.findNext();
	return true;
});

PreviousMatchFindAction.addImplementation(0, (accessor: ServicesAccessor, _codeEditor: ICodeEditor, _args: unknown) => {
	const editorService = accessor.get(IEditorService);
	const notebook = getNotebookInstanceFromActiveEditorPane(editorService);
	if (!notebook) {
		return false;
	}

	const controller = PositronNotebookFindController.get(notebook);
	if (!controller) {
		return false;
	}

	controller.findPrevious();
	return true;
});

// Invoked when Cmd+F is pressed while editing a notebook cell
StartFindAction.addImplementation(100, (accessor: ServicesAccessor, _codeEditor: ICodeEditor, _args: unknown) => {
	const editorService = accessor.get(IEditorService);
	const notebook = getNotebookInstanceFromActiveEditorPane(editorService);
	if (!notebook) {
		return false;
	}

	const controller = PositronNotebookFindController.get(notebook);
	if (!controller) {
		return false;
	}

	controller.start();
	return true;
});
