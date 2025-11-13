/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookCellActionBar.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { NotebookCellMoreActionsMenu } from './actionBar/NotebookCellMoreActionsMenu.js';
import { CellActionButton } from './actionBar/CellActionButton.js';
import { useObservedValue } from '../useObservedValue.js';
import { useMenu } from '../useMenu.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { useCellScopedContextKeyService } from './CellContextKeyServiceProvider.js';
import { useMenuActions } from '../useMenuActions.js';

interface NotebookCellActionBarProps {
	cell: IPositronNotebookCell;
}

export function NotebookCellActionBar({ cell }: NotebookCellActionBarProps) {
	// Context
	const contextKeyService = useCellScopedContextKeyService();

	// State
	const isActiveCell = useObservedValue(cell.isActive);
	const leftMenu = useMenu(MenuId.PositronNotebookCellActionBarLeft, contextKeyService);
	const submenu = useMenu(MenuId.PositronNotebookCellActionBarSubmenu, contextKeyService);
	const rightMenu = useMenu(MenuId.PositronNotebookCellActionBarRight, contextKeyService);
	const leftActions = useMenuActions(leftMenu);
	const submenuActions = useMenuActions(submenu);
	const rightActions = useMenuActions(rightMenu);

	const hasSubmenuActions = submenuActions.length > 0;

	// Only show action bar for the active cell
	const shouldShowActionBar = isActiveCell;

	return <div
		aria-hidden={!shouldShowActionBar}
		aria-label={localize('cellActions', 'Cell actions')}
		className={`positron-notebooks-cell-action-bar ${shouldShowActionBar ? 'visible' : 'hidden'}`}
		role='toolbar'
	>
		{/* Render contributed main actions - will auto-update when registry changes */}
		{leftActions
			.flatMap(([_group, actions]) => actions)
			.map(action => (
				<CellActionButton
					key={action.id}
					action={action}
					cell={cell}
				/>
			))}

		{/* Dropdown menu for additional actions - only render if there are menu actions */}
		{hasSubmenuActions ? (
			<NotebookCellMoreActionsMenu
				menuActions={submenuActions}
			/>
		) : null}

		{/* Render contributed mainRight actions - will auto-update when registry changes */}
		{rightActions
			.flatMap(([_group, actions]) => actions)
			.map(action => (
				<CellActionButton
					key={action.id}
					action={action}
					cell={cell}
				/>
			))}
	</div>;
}

