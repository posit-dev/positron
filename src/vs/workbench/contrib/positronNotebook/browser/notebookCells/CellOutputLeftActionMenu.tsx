/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellOutputLeftActionMenu.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { useMenu } from '../useMenu.js';
import { useMenuActions } from '../useMenuActions.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { useCellScopedContextKeyService } from './CellContextKeyServiceProvider.js';
import { NotebookCellMoreActionsMenu } from './actionBar/NotebookCellMoreActionsMenu.js';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell.js';

const cellOutputActions = localize('cellOutputActions', 'Cell Output Actions');

interface CellOutputLeftActionMenuProps {
	cell: PositronNotebookCodeCell;
}

/**
 * The left action menu for notebook cell output actions.
 * @param cell The cell that the menu actions will operate on
 */
export function CellOutputLeftActionMenu({ cell }: CellOutputLeftActionMenuProps) {
	const instance = useNotebookInstance();
	const contextKeyService = useCellScopedContextKeyService();

	const [isMenuOpen, setIsMenuOpen] = React.useState(false);
	const menu = useMenu(MenuId.PositronNotebookCellOutputActionLeft, contextKeyService);
	const menuActions = useMenuActions(menu);

	// Don't render if there are no actions
	if (menuActions.length === 0) {
		return null;
	}

	return (
		<div className='cell-output-left-action-menu'>
			<NotebookCellMoreActionsMenu
				ariaLabel={cellOutputActions}
				cell={cell}
				hoverManager={instance.hoverManager}
				instance={instance}
				isMenuOpen={isMenuOpen}
				menuActions={menuActions}
				setIsMenuOpen={setIsMenuOpen}
			/>
		</div>
	);
}
