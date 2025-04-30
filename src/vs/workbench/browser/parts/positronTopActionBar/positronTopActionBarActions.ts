/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { PositronTopActionBarVisibleContext } from '../../../common/contextkeys.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';

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
