/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../../nls.js';
import { KeyCode, KeyMod } from '../../../../../../base/common/keyCodes.js';
import { ContextKeyExpr } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { KeybindingWeight } from '../../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IQuickInputService } from '../../../../../../platform/quickinput/common/quickInput.js';
import { Action2, IAction2Options, registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { PositronModalReactRenderer } from '../../../../../../base/browser/positronModalReactRenderer.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { NotebookAction2 } from '../../NotebookAction2.js';
import { NotebookContextKeys } from '../../../common/notebookContextKeys.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../../common/positronNotebookCommon.js';
import { IPositronLMService } from '../../../../../services/positronLM/common/positronLMService.js';
import { showModelPicker } from '../../../../../services/positronLM/browser/positronLMModelPicker.js';
import { GhostCellController } from './controller.js';
import { POSITRON_NOTEBOOK_GHOST_CELL_MODEL_KEY, REQUEST_GHOST_CELL_SUGGESTION_COMMAND_ID, SELECT_GHOST_CELL_MODEL_COMMAND_ID, SHOW_GHOST_CELL_INFO_COMMAND_ID } from './config.js';
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
			NotebookContextKeys.editorFocused,
			NotebookContextKeys.cellEditorFocused.negate()
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
	precondition: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
	run: (controller) => controller.enableGhostCellSuggestionsForNotebook(),
});

// Show ghost cell info dialog - opens the informational dialog about ghost cell suggestions
registerGhostCellAction({
	id: SHOW_GHOST_CELL_INFO_COMMAND_ID,
	title: localize2('positronNotebook.showGhostCellInfo', 'About Ghost Cell Suggestions'),
	f1: true,
	category: localize2('positronNotebook.category', 'Positron Notebook'),
	precondition: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
	run: (controller) => {
		const state = controller.ghostCellState.get();
		const modelName = state.status === 'ready' ? state.modelName : undefined;
		const renderer = new PositronModalReactRenderer();
		renderer.render(<GhostCellInfoModalDialog modelName={modelName} renderer={renderer} />);
	},
});

// Select ghost cell model - plain Action2 so it works from Settings links (no active notebook required)
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SELECT_GHOST_CELL_MODEL_COMMAND_ID,
			title: localize2('positronNotebook.selectGhostCellModel', 'Select Ghost Cell Model'),
			f1: true,
			category: localize2('positronNotebook.category', 'Positron Notebook'),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const lmService = accessor.get(IPositronLMService);
		const configurationService = accessor.get(IConfigurationService);

		const currentPatterns = configurationService.getValue<string[]>(POSITRON_NOTEBOOK_GHOST_CELL_MODEL_KEY);
		// A single-element pattern that exactly matches a model ID indicates a pinned model
		const currentModelId = currentPatterns?.length === 1
			? lmService.availableModels.find(m => m.id === currentPatterns[0])?.id
			: undefined;

		const result = await showModelPicker(
			quickInputService,
			lmService.availableModels,
			localize('positron.selectGhostCellModel.title', "Select Model for Ghost Cell Suggestions"),
			currentModelId,
		);

		if (!result) {
			return;
		}

		if (result.kind === 'default') {
			await configurationService.updateValue(POSITRON_NOTEBOOK_GHOST_CELL_MODEL_KEY, undefined);
		} else {
			await configurationService.updateValue(POSITRON_NOTEBOOK_GHOST_CELL_MODEL_KEY, [result.model.id]);
		}
	}
});
