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

	// Convert registry items to menu entries
	// For PR1, this will return empty as no menu actions are registered yet
	// PR2 will add copy/paste actions here
	return actions.map(action => new CustomContextMenuItem({
		commandId: action.commandId,
		label: String(action.label ?? action.commandId), // TODO: Use CommandCenter.title when available
		icon: action.icon?.startsWith('codicon-') ? action.icon.slice(8) : action.icon,
		onSelected: () => {
			// IMPORTANT: Ensure the cell from this menu is selected before executing
			// Otherwise the command would operate on whatever cell is currently selected
			if (action.needsCellContext) {
				const currentState = instance.selectionStateMachine.state.get();
				const isSelected = (currentState.type !== 'NoSelection' &&
					currentState.type !== 'EditingSelection' &&
					currentState.selected.includes(cell));

				if (!isSelected) {
					instance.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
				}
			}

			// Execute command - it will now operate on the correct cell
			commandService.executeCommand(action.commandId);
		}
	}));
}
