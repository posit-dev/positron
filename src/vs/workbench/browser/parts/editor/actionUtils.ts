/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMenu, MenuItemAction } from 'vs/platform/actions/common/actions';
import { IAction, Separator, SubmenuAction } from 'vs/base/common/actions';

/**
 * Constants.
 */
const SEPARATOR = '--------------------------------------------------------------------------------\n';

/**
 * Dumps a menu.
 * @param description The description.
 * @param menu The menu to dump.
 */
export const dumpMenu = (description: string, menu: IMenu | undefined) => {
	// Start the dump.
	let x = SEPARATOR;
	x += `${description}\n`;

	// Dump the menu.
	if (!menu) {
		x += 'UNDEFINED\n';
	} else {
		for (const [group, actions] of menu.getActions()) {
			x += '    Group: ' + group + '\n';

			for (const action of actions) {
				x += dumpAction(action, 1);
			}
		}
	}

	// End the dump.
	x += SEPARATOR;
	console.log(x);
};

/**
 * Dumps primary and secondary actions.
 * @param description The description.
 * @param primaryActions The primary actions.
 * @param secondaryActions The secondary actions.
 */
export const dumpActions = (description: string, primaryActions: IAction[], secondaryActions: IAction[]) => {
	// Start the dump.
	let output = SEPARATOR;
	output += `${description}\n`;

	// Dump primary actions.
	output += 'Primary Actions:\n';
	for (const action of primaryActions) {
		output += dumpAction(action, 1);
	}

	// Dump secondary actions.
	output += 'Secondary Actions:\n';
	for (const action of secondaryActions) {
		output += dumpAction(action, 1);
	}

	// Finish the dump.
	output += SEPARATOR;
	console.log(output);
};

/**
 * Dumps an action.
 * @param action The action to dump.
 * @param level The level.
 * @returns The dumped action.
 */
const dumpAction = (action: IAction, level: number) => {
	// Create the spacer.
	const spacer = '    '.repeat(level);

	// Format the action info.
	let actionInfo = `id: ${action.id} label: ${action.label} tooltip: ${action.tooltip} enabled: ${action.enabled}`;
	if (action.class) {
		actionInfo += ` class: ${action.class}`;
	}

	// Build the output.
	let output = '';
	if (action instanceof MenuItemAction) {
		// Dump the menu item action.
		output += `${spacer}MenuItemAction ${actionInfo}\n`;
	} else if (action instanceof SubmenuAction) {
		// Dump the submenu action.
		output += `${spacer}SubmenuAction ${actionInfo}\n`;

		// Dump the submenu actions.
		for (const submenuAction of action.actions) {
			output += dumpAction(submenuAction, level + 1);
		}
	} else if (action instanceof Separator) {
		output += `${spacer}-\n`;
	} else {
		// Just a plain old action.
		output += `${spacer}Action ${actionInfo}\n`;
	}

	// Return the output.
	return output;
};
