/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../../../base/common/keyCodes.js';
import { ICodeEditor } from '../../../../../../editor/browser/editorBrowser.js';
import { EditorActionImplementation } from '../../../../../../editor/browser/editorExtensions.js';
import { PreviousMatchFindAction } from '../../../../../../editor/contrib/find/browser/findController.js';
import { CONTEXT_FIND_INPUT_FOCUSED, CONTEXT_FIND_WIDGET_VISIBLE } from '../../../../../../editor/contrib/find/browser/findModel.js';
import { localize2 } from '../../../../../../nls.js';
import { IAction2Options, registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED, POSITRON_NOTEBOOK_EDITOR_FOCUSED } from '../../ContextKeysManager.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { NotebookAction2 } from '../../NotebookAction2.js';
import { getNotebookInstanceFromActiveEditorPane } from '../../notebookUtils.js';
import { getActiveCell } from '../../selectionMachine.js';
import { PositronNotebookFindController } from './controller.js';

function registerPositronNotebookFindAction(
	options: IAction2Options & { run: (controller: PositronNotebookFindController) => void | Promise<void> },
) {
	return registerAction2(class extends NotebookAction2 {
		constructor() {
			super(options);
		}

		override async runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor): Promise<void> {
			const controller = PositronNotebookFindController.get(notebook);
			if (controller) {
				await options.run(controller);
			}
		}
	});
}

function findEditorActionImplementation(handler: (controller: PositronNotebookFindController) => void): EditorActionImplementation {
	return (accessor: ServicesAccessor, codeEditor: ICodeEditor, _args: unknown) => {
		// Get the active notebook instance
		const editorService = accessor.get(IEditorService);
		const notebook = getNotebookInstanceFromActiveEditorPane(editorService);
		if (!notebook) {
			return false;
		}

		// Confirm that the code editor matches the notebook's active cell.
		// This stops from stealing keyboard events from other code editors
		// like the output pane when a notebook is active.
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

// Start/reveal the find widget
registerPositronNotebookFindAction({
	id: 'positron.notebook.find.start',
	title: localize2('positron.notebook.find.start.title', 'Find'),
	keybinding: [{
		when: POSITRON_NOTEBOOK_EDITOR_FOCUSED,
		primary: KeyCode.KeyF | KeyMod.CtrlCmd,
		weight: KeybindingWeight.EditorContrib
	}],
	run: (controller) => controller.start()
});

// Hide the find widget
registerPositronNotebookFindAction({
	id: 'positron.notebook.find.hide',
	title: localize2('positron.notebook.find.hide.title', 'Hide Find'),
	keybinding: [{
		when: ContextKeyExpr.and(
			POSITRON_NOTEBOOK_EDITOR_FOCUSED,
			CONTEXT_FIND_WIDGET_VISIBLE,
		),
		primary: KeyCode.Escape,
		weight: KeybindingWeight.EditorContrib + 5
	}],
	run: (controller) => controller.hide()
});

// Find the next match
registerPositronNotebookFindAction({
	id: 'positron.notebook.find.next',
	title: localize2('positron.notebook.find.next.title', 'Find Next'),
	keybinding: [{
		// From cell editor
		when: POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED,
		primary: KeyCode.F3,
		mac: { primary: KeyMod.CtrlCmd | KeyCode.KeyG, secondary: [KeyCode.F3] },
		weight: KeybindingWeight.EditorContrib
	}, {
		// From find widget
		when: ContextKeyExpr.and(
			POSITRON_NOTEBOOK_EDITOR_FOCUSED,
			CONTEXT_FIND_INPUT_FOCUSED,
		),
		primary: KeyCode.Enter,
		weight: KeybindingWeight.EditorContrib + 5
	}],
	run: (controller) => controller.findNext()
});

// Find the previous match from command mode
registerPositronNotebookFindAction({
	id: 'positron.notebook.find.previous',
	title: localize2('positron.notebook.find.previous.title', 'Find Previous'),
	keybinding: [{
		// From cell editor
		when: POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED,
		primary: KeyMod.Shift | KeyCode.F3,
		mac: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyG, secondary: [KeyMod.Shift | KeyCode.F3] },
		weight: KeybindingWeight.EditorContrib
	},
	{
		// From find widget
		when: ContextKeyExpr.and(
			POSITRON_NOTEBOOK_EDITOR_FOCUSED,
			CONTEXT_FIND_INPUT_FOCUSED,
		),
		primary: KeyMod.Shift | KeyCode.Enter,
		weight: KeybindingWeight.EditorContrib + 5
	}],
	run: (controller) => controller.findPrevious()
});

// Find the previous match from cell editor
PreviousMatchFindAction.addImplementation(0, findEditorActionImplementation((controller) => controller.findPrevious()));
