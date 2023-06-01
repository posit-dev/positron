/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { Categories } from 'vs/platform/action/common/actionCommonCategories';
import { PositronTopActionBarVisibleContext } from 'vs/workbench/common/contextkeys';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { IPositronTopActionBarService } from 'vs/workbench/services/positronTopActionBar/browser/positronTopActionBarService';

/**
 * The PositronToggleTopActionBarVisibilityAction.
 */
export class PositronToggleTopActionBarVisibilityAction extends Action2 {
	/**
	 * The action ID.
	 */
	static readonly ID = 'workbench.action.positron.toggleTopActionBarVisibility';

	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronToggleTopActionBarVisibilityAction.ID,
			title: {
				value: localize('positron.toggleTopActionBarVisibility', "Toggle Top Bar Visibility"),
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

	/**
	 * Runs the action.
	 * @param accessor The ServicesAccessor.
	 */
	run(accessor: ServicesAccessor): void {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.setPartHidden(layoutService.isVisible(Parts.POSITRON_TOP_ACTION_BAR_PART), Parts.POSITRON_TOP_ACTION_BAR_PART);
	}
}

/**
 * Register the PositronToggleTopActionBarVisibilityAction.
 */
registerAction2(PositronToggleTopActionBarVisibilityAction);

/**
 * The PositronFocusTopActionBarAction.
 */
export class PositronFocusTopActionBarAction extends Action2 {
	/**
	 * The action ID.
	 */
	static readonly ID = 'workbench.action.positron.focusTopActionBar';

	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronFocusTopActionBarAction.ID,
			title: { value: localize('positron.focusTopActionBar', "Focus Top Bar"), original: 'Focus Top Bar' },
			category: Categories.View,
			f1: true
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The ServicesAccessor.
	 */
	async run(accessor: ServicesAccessor): Promise<void> {
		// Access the services we need.
		const layoutService = accessor.get(IWorkbenchLayoutService);

		// Focus the top action bar.
		layoutService.focusPart(Parts.POSITRON_TOP_ACTION_BAR_PART);
	}
}

/**
 * Register the PositronFocusTopActionBarAction.
 */
registerAction2(PositronFocusTopActionBarAction);

/**
 * The PositronShowStartInterpreterAction.
 */
export class PositronShowStartInterpreterAction extends Action2 {
	/**
	 * The ID.
	 */
	static readonly ID = 'workbench.action.positron.showStartInterpreter';

	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronShowStartInterpreterAction.ID,
			title: { value: localize('positron.showStartInterpreter', "Show Start Interpreter"), original: 'Show Start Interpreter' },
			category: Categories.View,
			f1: true
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The ServicesAccessor.
	 */
	async run(accessor: ServicesAccessor): Promise<void> {
		// Access the services we need.
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const positronTopActionBarService = accessor.get(IPositronTopActionBarService);

		// Make sure the top action bar is visible.
		if (!layoutService.isVisible(Parts.POSITRON_TOP_ACTION_BAR_PART)) {
			layoutService.setPartHidden(false, Parts.POSITRON_TOP_ACTION_BAR_PART);
		}

		// Show the start interpreter popup
		positronTopActionBarService.showStartInterpreterPopup();
	}
}

/**
 * Register the PositronShowStartInterpreterAction.
 */
registerAction2(PositronShowStartInterpreterAction);
