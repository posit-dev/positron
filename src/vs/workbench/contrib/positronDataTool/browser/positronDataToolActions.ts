/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { generateUuid } from 'vs/base/common/uuid';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';

/**
 * Positron data tool action category.
 */
const POSITRON_DATA_TOOL_ACTION_CATEGORY = localize(
	'positronDataToolCategory',
	"Positron Data Tool"
);

/**
 * The category for the actions below.
 */
const category: ILocalizedString = {
	value: POSITRON_DATA_TOOL_ACTION_CATEGORY,
	original: 'Positron Data Tool'
};

/**
 * Positron data tool command ID's.
 */
const enum PositronDataToolCommandId {
	TestAction = 'workbench.action.positronDataTool.open',
}

/**
 * OpenPositronDataTool action.
 */
class OpenPositronDataTool extends Action2 {
	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronDataToolCommandId.TestAction,
			title: {
				value: localize(
					'workbench.action.positronDataTool.openPositronDataTool',
					"Open Positron Data Tool"
				),
				original: 'Open Positron Data Tool'
			},
			f1: true,
			category,
			precondition: IsDevelopmentContext,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.Shift | KeyMod.WinCtrl | KeyMod.Alt | KeyCode.KeyT
			},
		});
	}

	/**
	 * Runs action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor) {
		// Access services.
		const editorService = accessor.get(IEditorService);
		const resource = URI.from({ scheme: Schemas.positronDataTool, path: `data-tool-${generateUuid()}` });
		await editorService.openEditor({ resource });
	}
}

/**
 * Registers Positron data tool actions.
 */
export function registerPositronDataToolActions() {
	registerAction2(OpenPositronDataTool);
}
