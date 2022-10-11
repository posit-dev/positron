/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { localize } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { ToolsBarVisibleContext } from 'vs/workbench/common/contextkeys';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';

export class ToggleToolsBarVisibilityAction extends Action2 {
	static readonly ID = 'workbench.action.toggleToolsBarVisibility';

	constructor() {
		super({
			id: ToggleToolsBarVisibilityAction.ID,
			title: {
				value: localize('toggleToolsBarVisibility', "Toggle Tools Bar Visibility"),
				mnemonicTitle: localize({ key: 'miToolsBar', comment: ['&& denotes a mnemonic'] }, "Tools Bar"), //TODO@softwarenerd assign mnemonic.
				original: 'Toggle Tools Bar Visibility'
			},
			category: CATEGORIES.View,
			f1: true,
			toggled: ToolsBarVisibleContext,
			menu: [{
				id: MenuId.MenubarAppearanceMenu,
				group: '1_workbench_layout',
				order: 1
			}]
		});
	}

	run(accessor: ServicesAccessor): void {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.setPartHidden(layoutService.isVisible(Parts.TOOLSBAR_PART), Parts.TOOLSBAR_PART);
	}
}

registerAction2(ToggleToolsBarVisibilityAction);

// Focus is a work in progress...
registerAction2(class FocusToolsBarAction extends Action2 {

	static readonly ID = 'workbench.action.focusToolsBar';

	constructor() {
		super({
			id: FocusToolsBarAction.ID,
			title: {
				value: localize('focusToolsBar', "Focus Tools Bar"),
				original: 'Focus Tools Bar'
			},
			category: CATEGORIES.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.focusPart(Parts.TOOLSBAR_PART);
	}
});
