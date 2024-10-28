/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from 'vs/nls';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { Categories } from 'vs/platform/action/common/actionCommonCategories';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

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
registerAction2(ToggleActionBarAction);
