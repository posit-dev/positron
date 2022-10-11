/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { localize } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { Categories } from 'vs/platform/action/common/actionCommonCategories';
import { TopBarVisibleContext } from 'vs/workbench/common/contextkeys';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';

export class ToggleTopBarVisibilityAction extends Action2 {

	static readonly ID = 'workbench.action.toggleTopBarVisibility';

	constructor() {
		super({
			id: ToggleTopBarVisibilityAction.ID,
			title: {
				value: localize('toggleTopBarVisibility', "Toggle Top Bar Visibility"),
				mnemonicTitle: localize({ key: 'miTopBar', comment: ['&& denotes a mnemonic'] }, "&&Top Bar"),
				original: 'Toggle Top Bar Visibility'
			},
			category: Categories.View,
			f1: true,
			toggled: TopBarVisibleContext,
			menu: [{
				id: MenuId.MenubarAppearanceMenu,
				group: '1_workbench_layout',
				order: 0
			}]
		});
	}

	run(accessor: ServicesAccessor): void {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.setPartHidden(layoutService.isVisible(Parts.TOPBAR_PART), Parts.TOPBAR_PART);
	}
}

registerAction2(ToggleTopBarVisibilityAction);

registerAction2(class FocusTopBarAction extends Action2 {
	static readonly ID = 'workbench.action.focusTopBar';
	static readonly LABEL = localize('focusTopBar', "Focus Top Bar");

	constructor() {
		super({
			id: FocusTopBarAction.ID,
			title: { value: FocusTopBarAction.LABEL, original: 'Focus Top Bar' },
			category: Categories.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.focusPart(Parts.TOPBAR_PART);
	}
});
