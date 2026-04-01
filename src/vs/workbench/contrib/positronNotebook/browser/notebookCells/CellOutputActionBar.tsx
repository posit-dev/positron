/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellOutputActionBar.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { CellActionButton } from './actionBar/CellActionButton.js';
import { useMenu } from '../useMenu.js';
import { useMenuActions } from '../useMenuActions.js';
import { useWheelForwarding } from './useWheelForwarding.js';
import { useCellScopedContextKeyService } from './CellContextKeyServiceProvider.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell.js';

interface CellOutputActionBarProps {
	cell: PositronNotebookCodeCell;
	scrollTargetRef: React.RefObject<HTMLElement | null>;
}

export function CellOutputActionBar({ cell, scrollTargetRef }: CellOutputActionBarProps) {
	const instance = useNotebookInstance();
	const contextKeyService = useCellScopedContextKeyService();
	const menu = useMenu(MenuId.PositronNotebookCellOutputActionBar, contextKeyService);
	const actionGroups = useMenuActions(menu);

	// Forward wheel events to the scrollable output container so scrolling
	// works even when the cursor is over the action bar.
	const barRef = React.useRef<HTMLDivElement>(null);
	useWheelForwarding(barRef, scrollTargetRef);

	return (
		<div
			ref={barRef}
			aria-label={localize('positron.notebook.cellOutputActions', 'Cell output actions')}
			className='cell-output-action-bar'
			role='toolbar'
		>
			{actionGroups.map(([_group, groupActions], groupIndex) =>
				groupActions.map((action, actionIndex) => (
					<CellActionButton
						key={action.id}
						action={action}
						cell={cell}
						hoverManager={instance.hoverManager}
						showSeparator={
							// Show a separator before the last group
							groupIndex === actionGroups.length - 2 &&
							actionIndex === groupActions.length - 1
						}
					/>
				))
			)}
		</div>
	);
}
