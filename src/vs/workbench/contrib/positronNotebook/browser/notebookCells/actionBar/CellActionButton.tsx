/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import { CellSelectionType } from '../../selectionMachine.js';
import { useNotebookInstance } from '../../NotebookInstanceProvider.js';
import { ActionButton } from '../../utilityComponents/ActionButton.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { MenuItemAction, SubmenuItemAction } from '../../../../../../platform/actions/common/actions.js';
import { Icon } from '../../../../../../platform/positronActionBar/browser/components/icon.js';
import { Codicon } from '../../../../../../base/common/codicons.js';

/**
 * Standardized action button component for notebook cell actions. Handles cell selection and command execution.
 * @param action The action to execute
 * @param cell The cell to execute the action on
 * @returns A button that executes the action when clicked.
 */
export function CellActionButton({ action, cell }: { action: MenuItemAction | SubmenuItemAction; cell: IPositronNotebookCell; }) {
	const instance = useNotebookInstance();

	const handleActionClick = async (action: MenuItemAction | SubmenuItemAction) => {
		// Actions assume cell is selected, so ensure this is the case
		instance.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);

		// Execute the command (without passing cell as argument)
		try {
			await action.run();
		} catch (error) {
			console.log(error);
		}
	};

	return (
		<ActionButton
			key={action.id}
			ariaLabel={action.label}
			tooltip={action.tooltip}
			onPressed={() => handleActionClick(action)}
		>
			{/* Default to a warning symbol as a dev warning - we shouldn't have cell actions without icons */}
			{<Icon icon={action.item.icon ?? Codicon.warning} />}
		</ActionButton>
	);
}
