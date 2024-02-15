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
import { IPositronDataExplorerService } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';

/**
 * Positron data explorer action category.
 */
const POSITRON_DATA_EXPLORER_ACTION_CATEGORY = localize(
	'positronDataExplorerCategory',
	"Positron Data Explorer"
);

/**
 * The category for the actions below.
 */
const category: ILocalizedString = {
	value: POSITRON_DATA_EXPLORER_ACTION_CATEGORY,
	original: 'Positron Data Explorer'
};

/**
 * Positron data explorer command ID's.
 */
const enum PositronDataExplorerCommandId {
	TestAction = 'workbench.action.positronDataExplorer.open',
}

/**
 * OpenPositronDataExplorer action.
 */
class OpenPositronDataExplorer extends Action2 {
	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronDataExplorerCommandId.TestAction,
			title: {
				value: localize(
					'workbench.action.positronDataExplorer.openPositronDataExplorer',
					"Open Positron Data Explorer"
				),
				original: 'Open Positron Data Explorer'
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
		const positronDataExplorerService = accessor.get(IPositronDataExplorerService);

		// Test opening a positron data explorer.
		await positronDataExplorerService.testOpen('b809490e-1801-4f2f-911c-7b9539c78204');
	}
}

/**
 * Registers Positron data explorer actions.
 */
export function registerPositronDataExplorerActions() {
	registerAction2(OpenPositronDataExplorer);
}
