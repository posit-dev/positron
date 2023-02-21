/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { localize } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { Categories } from 'vs/platform/action/common/actionCommonCategories';
import { PositronTopActionBarVisibleContext } from 'vs/workbench/common/contextkeys';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';

export class ToggleTopActionBarVisibilityAction extends Action2 {

	static readonly ID = 'workbench.action.togglePositronTopActionBarVisibility';

	constructor() {
		super({
			id: ToggleTopActionBarVisibilityAction.ID,
			title: {
				value: localize('togglePositronTopActionBarVisibility', "Toggle Top Bar Visibility"),
				mnemonicTitle: localize({ key: 'miTopActionBar', comment: ['&& denotes a mnemonic'] }, "&&Top Bar"),
				original: 'Toggle Top Bar Visibility'
			},
			category: Categories.View,
			f1: true,
			toggled: PositronTopActionBarVisibleContext,
			menu: [{
				id: MenuId.MenubarAppearanceMenu,
				group: '1_workbench_layout',
				order: 0
			}]
		});
	}

	run(accessor: ServicesAccessor): void {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.setPartHidden(layoutService.isVisible(Parts.POSITRON_TOP_ACTION_BAR_PART), Parts.POSITRON_TOP_ACTION_BAR_PART);
	}
}

registerAction2(ToggleTopActionBarVisibilityAction);

registerAction2(class FocusTopActionBarAction extends Action2 {
	static readonly ID = 'workbench.action.focusPositronTopActionBar';
	static readonly LABEL = localize('focusTopActionBar', "Focus Top Bar");

	constructor() {
		super({
			id: FocusTopActionBarAction.ID,
			title: { value: FocusTopActionBarAction.LABEL, original: 'Focus Top Bar' },
			category: Categories.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.focusPart(Parts.POSITRON_TOP_ACTION_BAR_PART);
	}
});
