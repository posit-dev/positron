/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../../../base/common/keyCodes.js';
import { ICodeEditor } from '../../../../../../editor/browser/editorBrowser.js';
import { EditorActionImplementation } from '../../../../../../editor/browser/editorExtensions.js';
import { EditorContextKeys } from '../../../../../../editor/common/editorContextKeys.js';
import { NextMatchFindAction, PreviousMatchFindAction, StartFindAction } from '../../../../../../editor/contrib/find/browser/findController.js';
import { CONTEXT_FIND_WIDGET_VISIBLE } from '../../../../../../editor/contrib/find/browser/findModel.js';
import { localize2 } from '../../../../../../nls.js';
import { IAction2Options, registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED, POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED } from '../../ContextKeysManager.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { NotebookAction2 } from '../../NotebookAction2.js';
import { getNotebookInstanceFromActiveEditorPane } from '../../notebookUtils.js';
import { getActiveCell } from '../../selectionMachine.js';
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

function registerPositronNotebookFindAction(
	options: IAction2Options & { run: (controller: PositronNotebookFindController) => void | Promise<void> },
) {
	return registerAction2(class extends PositronNotebookFindAction {
		constructor() {
			super(options);
		}

		override async runFindAction(controller: PositronNotebookFindController): Promise<void> {
			return options.run(controller);
		}
	});
}

registerPositronNotebookFindAction({
	id: 'positron.notebook.find.focus',
	title: localize2('positron.notebook.find.focus.title', 'Focus Find'),
	keybinding: {
		when: ContextKeyExpr.and(
			POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
			EditorContextKeys.focus.toNegated()
		),
		primary: KeyCode.KeyF | KeyMod.CtrlCmd,
		weight: KeybindingWeight.WorkbenchContrib
	},
	run: (controller) => controller.start()
});

function findEditorActionImplementation(handler: (controller: PositronNotebookFindController) => void): EditorActionImplementation {
	return (accessor: ServicesAccessor, codeEditor: ICodeEditor, _args: unknown) => {
		// Get the active notebook instance
		const editorService = accessor.get(IEditorService);
		const notebook = getNotebookInstanceFromActiveEditorPane(editorService);
		if (!notebook) {
			return false;
		}

		// Confirm that the code editor matches the notebook's active cell
		const activeCell = getActiveCell(notebook.selectionStateMachine.state.get());
		if (activeCell?.currentEditor !== codeEditor) {
			return false;
		}

		// Get the find controller
		const controller = PositronNotebookFindController.get(notebook);
		if (!controller) {
			return false;
		}

		// Invoke the handler
		handler(controller);
		return true;
	};
}

// Invoked when Cmd+F is pressed while editing a notebook cell
StartFindAction.addImplementation(100, findEditorActionImplementation((controller) => controller.start()));

registerAction2(class extends PositronNotebookFindAction {
	constructor() {
		super({
			id: 'positron.notebook.find.hide',
			title: localize2('positron.notebook.find.hide.title', 'Hide Find'),
			keybinding: {
				when: ContextKeyExpr.and(
					ContextKeyExpr.or(
						POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
						POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED,
					),
					CONTEXT_FIND_WIDGET_VISIBLE,
				),
				primary: KeyCode.Escape,
				weight: KeybindingWeight.EditorContrib + 5
			}
		});
	}

	override async runFindAction(controller: PositronNotebookFindController): Promise<void> {
		controller.hide();
	}
});

// registerAction2(class extends PositronNotebookFindAction {
// 	constructor() {
// 		super({
// 			id: 'positron.notebook.findNext',
// 			title: localize2('positron.notebook.findNext.title', 'Find Next'),

NextMatchFindAction.addImplementation(0, findEditorActionImplementation((controller) => controller.findNext));

PreviousMatchFindAction.addImplementation(0, findEditorActionImplementation((controller) => controller.findPrevious));
