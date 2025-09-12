/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import { usePositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';
import { CellSelectionType } from '../../../../../services/positronNotebook/browser/selectionMachine.js';
import { useNotebookInstance } from '../../NotebookInstanceProvider.js';
import { ActionButton } from '../../utilityComponents/ActionButton.js';
import { INotebookCellActionBarItem } from './actionBarRegistry.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';

/**
 * Standardized action button component for notebook cell actions. Handles cell selection and command execution.
 * @param action The action to execute
 * @param cell The cell to execute the action on
 * @returns A button that executes the action when clicked.
 */
export function CellActionButton({ action, cell }: { action: INotebookCellActionBarItem; cell: IPositronNotebookCell; }) {

	// Import command service
	const { commandService } = usePositronReactServicesContext();

	const instance = useNotebookInstance();

	const handleActionClick = (action: INotebookCellActionBarItem) => {
		// If action needs cell context, ensure cell is selected first
		instance.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);

		// Execute the command (without passing cell as argument)
		commandService.executeCommand(action.commandId);
	};

	return (
		<ActionButton
			key={action.commandId}
			ariaLabel={String(action.label ?? action.commandId)}
			onPressed={() => handleActionClick(action)}
		>
			<div className={`button-icon codicon ${action.icon}`} />
		</ActionButton>
	);
}
