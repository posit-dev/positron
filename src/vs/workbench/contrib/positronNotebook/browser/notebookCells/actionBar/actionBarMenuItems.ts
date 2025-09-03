/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { CustomContextMenuItem } from '../../../../../../workbench/browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { CustomContextMenuEntry } from '../../../../../../workbench/browser/positronComponents/customContextMenu/customContextMenu.js';
import { IPositronNotebookInstance } from '../../../../../services/positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookCell } from '../../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { CellSelectionType } from '../../../../../services/positronNotebook/browser/selectionMachine.js';
import { NotebookCellActionBarRegistry, INotebookCellActionBarItem } from './actionBarRegistry.js';
import { CustomContextMenuSeparator } from '../../../../../browser/positronComponents/customContextMenu/customContextMenuSeparator.js';

/**
 * Build the menu entries for the "more actions" dropdown menu.
 * This provides a clean extension point for adding new actions via the registry.
 */
export function buildMoreActionsMenuItems(
	instance: IPositronNotebookInstance,
	commandService: ICommandService,
	cell: IPositronNotebookCell,
	menuActions?: INotebookCellActionBarItem[]
): CustomContextMenuEntry[] {
	// Use provided menuActions or fallback to getting all from registry
	const actions = menuActions ?? NotebookCellActionBarRegistry.getInstance().menuActions.get();

	// Get the categories
	const entriesByCategory = new Map<string, CustomContextMenuEntry[]>();
	actions.forEach(action => {
		if (action.category) {
			if (!entriesByCategory.has(action.category)) {
				entriesByCategory.set(action.category, []);
			}
			entriesByCategory.get(action.category)?.push(new CustomContextMenuItem({
				commandId: action.commandId,
				label: String(action.label ?? action.commandId), // TODO: Use CommandCenter.title when available
				icon: action.icon?.startsWith('codicon-') ? action.icon.slice(8) : action.icon,
				onSelected: () => {
					// IMPORTANT: Ensure the cell from this menu is selected before executing
					// Otherwise the command would operate on whatever cell is currently selected
					if (action.needsCellContext) {
						instance.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
					}

					// Execute command - it will now operate on the correct cell
					commandService.executeCommand(action.commandId);
				}
			}));
		}
	});

	// Convert the entries by category to a flat array with separators between categories
	const contextMenuEntries: CustomContextMenuEntry[] = [];
	const categories = Array.from(entriesByCategory.keys());
	categories.forEach((category, index) => {
		const entries = entriesByCategory.get(category)!;
		contextMenuEntries.push(...entries);

		// Add separator after each category except the last
		if (index < categories.length - 1) {
			contextMenuEntries.push(new CustomContextMenuSeparator());
		}
	});

	return contextMenuEntries;
}
