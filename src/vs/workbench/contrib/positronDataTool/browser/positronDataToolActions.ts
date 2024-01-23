/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IPositronDataToolService } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolService';

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
		const positronDataToolService = accessor.get(IPositronDataToolService);

		// Test opening a positron data tool.
		await positronDataToolService.testOpen('b809490e-1801-4f2f-911c-7b9539c78204');
	}
}

/**
 * Registers Positron data tool actions.
 */
export function registerPositronDataToolActions() {
	registerAction2(OpenPositronDataTool);
}
