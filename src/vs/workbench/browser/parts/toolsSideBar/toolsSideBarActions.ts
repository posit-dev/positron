/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { localize } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { Categories } from 'vs/platform/action/common/actionCommonCategories';
import { ToolsSideBarVisibleContext } from 'vs/workbench/common/contextkeys';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';

export class ToggleToolsSideBarVisibilityAction extends Action2 {
	static readonly ID = 'workbench.action.toggleToolsSideBarVisibility';

	constructor() {
		super({
			id: ToggleToolsSideBarVisibilityAction.ID,
			title: {
				value: localize('toggleToolsSideBarVisibility', "Toggle Tools Side Bar Visibility"),
				mnemonicTitle: localize({ key: 'miToolsSideBar', comment: ['&& denotes a mnemonic'] }, "Tools Side Bar"), //TODO@softwarenerd assign mnemonic.
				original: 'Toggle Tools Side Bar Visibility'
			},
			category: Categories.View,
			f1: true,
			toggled: ToolsSideBarVisibleContext,
			menu: [{
				id: MenuId.MenubarAppearanceMenu,
				group: '1_workbench_layout',
				order: 1
			}]
		});
	}

	run(accessor: ServicesAccessor): void {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.setPartHidden(layoutService.isVisible(Parts.TOOLSSIDEBAR_PART), Parts.TOOLSSIDEBAR_PART);
	}
}

registerAction2(ToggleToolsSideBarVisibilityAction);

// Focus is a work in progress...
registerAction2(class FocusToolsSideBarAction extends Action2 {

	static readonly ID = 'workbench.action.focusToolsSideBar';

	constructor() {
		super({
			id: FocusToolsSideBarAction.ID,
			title: {
				value: localize('focusToolsSideBar', "Focus Tools Side Bar"),
				original: 'Focus Tools Side Bar'
			},
			category: Categories.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.focusPart(Parts.TOOLSSIDEBAR_PART);
	}
});
