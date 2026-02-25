/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../../../nls.js';
import { KeyCode, KeyMod } from '../../../../../../base/common/keyCodes.js';
import { ContextKeyExpr } from '../../../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '../../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IAction2Options, registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { PositronModalReactRenderer } from '../../../../../../base/browser/positronModalReactRenderer.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { NotebookAction2 } from '../../NotebookAction2.js';
import { POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED, POSITRON_NOTEBOOK_EDITOR_FOCUSED } from '../../ContextKeysManager.js';
import { GhostCellController } from './controller.js';
import { REQUEST_GHOST_CELL_SUGGESTION_COMMAND_ID, SHOW_GHOST_CELL_INFO_COMMAND_ID } from './config.js';
import { GhostCellInfoModalDialog } from './GhostCellInfoModalDialog.js';

// Helper function matching the FindController pattern (contrib/find/actions.ts)
function registerGhostCellAction(
	options: IAction2Options & { run: (controller: GhostCellController) => void | Promise<void> },
) {
	return registerAction2(class extends NotebookAction2 {
		constructor() {
			super(options);
		}

		override async runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor): Promise<void> {
			const controller = GhostCellController.get(notebook);
			if (controller) {
				await options.run(controller);
			}
		}
	});
}

// Request ghost cell suggestion - works from any state when the notebook editor is focused
registerGhostCellAction({
	id: REQUEST_GHOST_CELL_SUGGESTION_COMMAND_ID,
	title: localize2('positronNotebook.requestGhostCellSuggestion', 'Request Ghost Cell Suggestion'),
	keybinding: {
		// Require notebook DOM focus and exclude cell editor focus to avoid
		// stealing Cmd+Shift+G from terminal Find Previous or notebook Find Previous
		when: ContextKeyExpr.and(
			POSITRON_NOTEBOOK_EDITOR_FOCUSED,
			POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED.negate()
		),
		// Must be higher than editor.action.announceCursorPosition (WorkbenchContrib + 10)
		weight: KeybindingWeight.WorkbenchContrib + 50,
		primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyG
	},
	run: (controller) => controller.requestGhostCellSuggestion(),
});

// Enable ghost cell suggestions for this notebook - clears per-notebook disable setting
registerGhostCellAction({
	id: 'positronNotebook.enableGhostCellSuggestionsForNotebook',
	title: localize2('positronNotebook.enableGhostCellSuggestionsForNotebook', 'Enable Ghost Cell Suggestions for This Notebook'),
	f1: true,
	category: localize2('positronNotebook.category', 'Positron Notebook'),
	run: (controller) => controller.enableGhostCellSuggestionsForNotebook(),
});

// Show ghost cell info dialog - opens the informational dialog about ghost cell suggestions
registerGhostCellAction({
	id: SHOW_GHOST_CELL_INFO_COMMAND_ID,
	title: localize2('positronNotebook.showGhostCellInfo', 'About Ghost Cell Suggestions'),
	f1: true,
	category: localize2('positronNotebook.category', 'Positron Notebook'),
	precondition: ContextKeyExpr.equals('activeEditor', 'workbench.editor.positronNotebook'),
	run: (controller) => {
		const state = controller.ghostCellState.get();
		const modelName = state.status === 'ready' ? state.modelName : undefined;
		const renderer = new PositronModalReactRenderer();
		renderer.render(<GhostCellInfoModalDialog modelName={modelName} renderer={renderer} />);
	},
});
