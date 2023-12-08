/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { PositronDataToolEditor } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolEditor';

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
			// precondition: PositronConsoleFocused,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.WinCtrl | KeyCode.KeyA
			},
		});
	}

	/**
	 * Runs action.
	 * @param accessor The services accessor.
	 */
	async run(accessor: ServicesAccessor) {
		const instantiationService = accessor.get(IInstantiationService);
		const editorService = accessor.get(IEditorService);

		const handle = Math.floor(Math.random() * 1e9);
		const fd = URI.from({ scheme: Schemas.positronDataTool, path: `chat-${handle}` });
		const d = await editorService.openEditor({ resource: fd });

		if (d) {
			console.log(`Title is ${d.getTitle()}`);
		}

		instantiationService.createInstance(PositronDataToolEditor);
	}
}

/**
 * Registers Positron data tool actions.
 */
export function registerPositronDataToolActions() {
	registerAction2(OpenPositronDataTool);
}
