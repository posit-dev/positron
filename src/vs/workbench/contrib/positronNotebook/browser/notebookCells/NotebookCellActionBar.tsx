/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookCellActionBar.css';

// React.
import React, { useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { CellSelectionStatus, IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { NotebookCellMoreActionsMenu } from './actionBar/NotebookCellMoreActionsMenu.js';
import { useActionsForCell } from './actionBar/useActionsForCell.js';
import { CellActionButton } from './actionBar/CellActionButton.js';
import { useObservedValue } from '../useObservedValue.js';

interface NotebookCellActionBarProps {
	cell: IPositronNotebookCell;
	children: React.ReactNode;
}

export function NotebookCellActionBar({ cell, children }: NotebookCellActionBarProps) {
	const actionsForCell = useActionsForCell();
	const instance = useNotebookInstance();
	const mainActions = actionsForCell.main;
	const mainRightActions = actionsForCell['mainRight'];
	const menuActions = actionsForCell.menu;
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const selectionStatus = useObservedValue(cell.selectionStatus);

	const hasMenuActions = menuActions.length > 0;

	// Determine visibility using the extracted hook
	const shouldShowActionBar = isMenuOpen || selectionStatus === CellSelectionStatus.Selected || selectionStatus === CellSelectionStatus.Editing;

	return <div
		aria-hidden={!shouldShowActionBar}
		aria-label={localize('cellActions', 'Cell actions')}
		className={`positron-notebooks-cell-action-bar ${shouldShowActionBar ? 'visible' : 'hidden'}`}
		role='toolbar'
	>
		{/* Render cell-specific actions (e.g., run button for code cells) */}
		{children}

		{/* Render contributed main actions - will auto-update when registry changes */}
		{mainActions.map(action => (
			<CellActionButton
				key={action.commandId}
				action={action}
				cell={cell}
			/>
		))}

		{/* Dropdown menu for additional actions - only render if there are menu actions */}
		{hasMenuActions ? (
			<NotebookCellMoreActionsMenu
				cell={cell}
				instance={instance}
				menuActions={menuActions}
				onMenuStateChange={setIsMenuOpen}
			/>
		) : null}

		{/* Render contributed mainRight actions - will auto-update when registry changes */}
		{mainRightActions.map(action => (
			<CellActionButton
				key={action.commandId}
				action={action}
				cell={cell}
			/>
		))}
	</div>;
}

