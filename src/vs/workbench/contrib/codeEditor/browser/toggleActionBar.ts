/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

/**
 * ToggleActionBarAction class.
 */
export class ToggleActionBarAction extends Action2 {
	/**
	 * Gets the ID.
	 */
	static readonly ID = 'editor.action.toggleActionBar';

	/**
	 * Constructor.
	 */
	constructor() {
		// Call the base class's constructor.
		super({
			id: ToggleActionBarAction.ID,
			title: {
				...localize2('toggleActionBar', "Toggle Editor Action Bar"),
				mnemonicTitle: localize({ key: 'miActionBar', comment: ['&& denotes a mnemonic'] }, "&&Editor Action Bar"),
			},
			category: Categories.View,
			f1: true,
			toggled: ContextKeyExpr.equals('config.editor.actionBar.enabled', true),
			menu: {
				id: MenuId.MenubarAppearanceMenu,
				group: '4_editor',
				order: 1
			}
		});
	}

	/**
	 * Runs the action.
	 * @param accessor The services accessor.
	 */
	override async run(accessor: ServicesAccessor): Promise<void> {
		// Get the configuration service.
		const configurationService = accessor.get(IConfigurationService);

		// Update the value.
		return configurationService.updateValue(
			'editor.actionBar.enabled',
			!configurationService.getValue('editor.actionBar.enabled')
		);
	}
}

/**
 * Registers the action.
 */
// At the moment, do not register the ToggleActionBarAction because it is still experimental.
// registerAction2(ToggleActionBarAction);
