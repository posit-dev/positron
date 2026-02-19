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
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { NotebookAction2 } from '../../NotebookAction2.js';
import { POSITRON_NOTEBOOK_EDITOR_FOCUSED } from '../../ContextKeysManager.js';
import { GhostCellController, POSITRON_NOTEBOOK_GHOST_CELL_AWAITING_REQUEST } from './controller.js';

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

// Request ghost cell suggestion - triggered in pull mode when awaiting-request state is active
registerGhostCellAction({
	id: 'positronNotebook.requestGhostCellSuggestion',
	title: localize2('positronNotebook.requestGhostCellSuggestion', 'Request Ghost Cell Suggestion'),
	keybinding: {
		when: ContextKeyExpr.and(
			POSITRON_NOTEBOOK_EDITOR_FOCUSED,
			POSITRON_NOTEBOOK_GHOST_CELL_AWAITING_REQUEST
		),
		weight: KeybindingWeight.EditorContrib,
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
