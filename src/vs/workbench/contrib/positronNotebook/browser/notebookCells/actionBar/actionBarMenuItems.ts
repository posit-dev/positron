/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CustomContextMenuItem } from '../../../../../../workbench/browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { CustomContextMenuEntry } from '../../../../../../workbench/browser/positronComponents/customContextMenu/customContextMenu.js';
import { CustomContextMenuSeparator } from '../../../../../browser/positronComponents/customContextMenu/customContextMenuSeparator.js';
import { MenuItemAction, SubmenuItemAction } from '../../../../../../platform/actions/common/actions.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { CellSelectionType } from '../../selectionMachine.js';

/**
 * Build the menu entries for the "more actions" dropdown menu.
 * This provides a clean extension point for adding new actions via the registry.
 *
 * Note: Like the CellActionButton component, we need to ensure the cell is selected
 * before running any action. This is done via the onWillSelect callback which runs
 * before the command is executed.
 *
 * @param cell The cell that the menu actions will operate on
 * @param menuActions The grouped menu actions to display
 * @param instance The notebook instance (needed to select cell before action runs)
 */
export function buildMoreActionsMenuItems(
	cell: IPositronNotebookCell,
	menuActions: [string, (MenuItemAction | SubmenuItemAction)[]][],
	instance: IPositronNotebookInstance,
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
			onWillSelect: () => {
				// Select cell BEFORE command runs to keep notebook selection in sync
				instance.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
			},
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
