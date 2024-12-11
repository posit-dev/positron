/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { OS } from '../../../base/common/platform.js';
import { IAction } from '../../../base/common/actions.js';
import { UILabelProvider } from '../../../base/common/keybindingLabels.js';
import { MenuItemAction } from '../../actions/common/actions.js';
import { IContextKeyService } from '../../contextkey/common/contextkey.js';
import { IKeybindingService } from '../../keybinding/common/keybinding.js';

/**
 * Gets a menu action item from an action.
 * @param action The action.
 * @returns The menu action item, or undefined if the action is not a menu item action.
 */
export const toMenuActionItem = (action: IAction) =>
	action instanceof MenuItemAction ? action : undefined;

/**
 * Returns the action tooltip for an action.
 * @param contextKeyService The context key service.
 * @param keybindingService The keybinding service.
 * @param action The action.
 * @param includeAlternativeAction A value which indicates whether the alternative action should be
 * included.
 * @returns The action tooltip.
 */
export const actionTooltip = (
	contextKeyService: IContextKeyService,
	keybindingService: IKeybindingService,
	action: IAction,
	includeAlternativeAction: boolean,
) => {
	// Get the keybinding, keybinding label, and tooltip.
	const keybinding = keybindingService.lookupKeybinding(
		action.id,
		contextKeyService
	);
	const keybindingLabel = keybinding && keybinding.getLabel();
	const tooltip = action.tooltip || action.label;

	// Set the formatted tooltip.
	let formattedTooltip = keybindingLabel ?
		localize('titleAndKb', "{0} ({1})", tooltip, keybindingLabel) :
		tooltip;

	// Add the alt keybinding and label to the formatted tooltip.
	const menuActionItem = toMenuActionItem(action);
	if (includeAlternativeAction && menuActionItem && menuActionItem.alt?.enabled) {
		// Get the alt keybinding, alt keybinding label, and alt tooltip.
		const altKeybinding = keybindingService.lookupKeybinding(
			menuActionItem.alt.id,
			contextKeyService
		);
		const altKeybindingLabel = altKeybinding && altKeybinding.getLabel();
		const altTooltip = menuActionItem.alt.tooltip || menuActionItem.alt.label;

		// Update the formatted tooltip.
		formattedTooltip = localize(
			'titleAndKbAndAlt', "{0}\n[{1}] {2}",
			formattedTooltip,
			UILabelProvider.modifierLabels[OS].altKey,
			altKeybindingLabel
				? localize('titleAndKb', "{0} ({1})", altTooltip, altKeybindingLabel)
				: altTooltip
		);
	}

	// Return the formatted tooltip.
	return formattedTooltip;
};
