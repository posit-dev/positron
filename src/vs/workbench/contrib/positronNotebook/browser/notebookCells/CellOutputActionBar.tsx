/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellOutputActionBar.css';

// Other dependencies.
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { CellActionButton } from './actionBar/CellActionButton.js';
import { useMenu } from '../useMenu.js';
import { useMenuActions } from '../useMenuActions.js';
import { useCellScopedContextKeyService } from './CellContextKeyServiceProvider.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell.js';

interface CellOutputActionBarProps {
	cell: PositronNotebookCodeCell;
}

export function CellOutputActionBar({ cell }: CellOutputActionBarProps) {
	const instance = useNotebookInstance();
	const contextKeyService = useCellScopedContextKeyService();
	const menu = useMenu(MenuId.PositronNotebookCellOutputActionLeft, contextKeyService);
	const actionGroups = useMenuActions(menu);

	const actions = actionGroups.flatMap(([_group, groupActions]) => groupActions);

	if (actions.length === 0) {
		return null;
	}

	// Build a set of action IDs that are the last in their group (for separators)
	const lastInGroup = new Set(
		actionGroups
			.slice(0, -1) // No separator after the final group
			.map(([_group, groupActions]) => groupActions[groupActions.length - 1]?.id)
			.filter(Boolean)
	);

	return (
		<div className='cell-output-action-bar' role='toolbar'>
			{actions.map(action => (
				<CellActionButton
					key={action.id}
					action={action}
					cell={cell}
					hoverManager={instance.hoverManager}
					showSeparator={lastInGroup.has(action.id)}
				/>
			))}
		</div>
	);
}
