/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CustomContextMenuItem } from '../../../../../../workbench/browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { CustomContextMenuEntry } from '../../../../../../workbench/browser/positronComponents/customContextMenu/customContextMenu.js';
import { CustomContextMenuSeparator } from '../../../../../browser/positronComponents/customContextMenu/customContextMenuSeparator.js';
import { MenuItemAction, SubmenuItemAction } from '../../../../../../platform/actions/common/actions.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';

/**
 * Build the menu entries for the "more actions" dropdown menu.
 * This provides a clean extension point for adding new actions via the registry.
 */
export function buildMoreActionsMenuItems(
	menuActions: [string, (MenuItemAction | SubmenuItemAction)[]][],
): CustomContextMenuEntry[] {
	// Get the groups
	const entriesByGroup = new Map<string, CustomContextMenuEntry[]>();
	menuActions.forEach(([group, groupActions]) => {
		if (!entriesByGroup.has(group)) {
			entriesByGroup.set(group, []);
		}
		entriesByGroup.get(group)?.push(...groupActions.map(action => new CustomContextMenuItem({
			commandId: action.id,
			label: action.label,
			icon: ThemeIcon.isThemeIcon(action.item.icon) ? action.item.icon.id : undefined,
			onSelected: () => {
				// No op as command is executed via the commandId argument
			}
		})));
	});

	// Convert the entries by group to a flat array with separators between groups
	const contextMenuEntries: CustomContextMenuEntry[] = [];
	const groups = Array.from(entriesByGroup.keys());
	groups.forEach((group, index) => {
		const entries = entriesByGroup.get(group)!;
		contextMenuEntries.push(...entries);

		// Add separator after each group except the last
		if (index < groups.length - 1) {
			contextMenuEntries.push(new CustomContextMenuSeparator());
		}
	});

	return contextMenuEntries;
}
