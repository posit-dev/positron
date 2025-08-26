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
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { IPositronNotebookCell } from '../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { ActionButton } from '../utilityComponents/ActionButton.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { useSelectionStatus } from './useSelectionStatus.js';
import { NotebookCellMoreActionsMenu } from './actionBar/NotebookCellMoreActionsMenu.js';
import { useActionBarVisibility } from './actionBar/useActionBarVisibility.js';
import { NotebookCellActionBarRegistry, INotebookCellActionBarItem } from './actionBar/actionBarRegistry.js';
import { useObservedValue } from '../useObservedValue.js';
import { CellSelectionType } from '../../../../services/positronNotebook/browser/selectionMachine.js';


interface NotebookCellActionBarProps {
	cell: IPositronNotebookCell;
	children: React.ReactNode;
	isHovered: boolean;
}

export function NotebookCellActionBar({ cell, children, isHovered }: NotebookCellActionBarProps) {
	const services = usePositronReactServicesContext();
	const commandService = services.commandService;
	const instance = useNotebookInstance();
	const registry = NotebookCellActionBarRegistry.getInstance();
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const selectionStatus = useSelectionStatus(cell);

	// Use observable values for reactive updates
	const mainActions = useObservedValue(registry.mainActions) ?? [];
	const menuActions = useObservedValue(registry.menuActions) ?? [];
	const hasMenuActions = menuActions.length > 0;

	// Determine visibility using the extracted hook
	const shouldShowActionBar = useActionBarVisibility(isHovered, isMenuOpen, selectionStatus);

	const handleActionClick = (action: INotebookCellActionBarItem) => {
		// If action needs cell context, ensure cell is selected first
		if (action.needsCellContext) {
			// Select the cell if not already selected
			const currentState = instance.selectionStateMachine.state.get();
			const isSelected = (currentState.type !== 'NoSelection' &&
				currentState.type !== 'EditingSelection' &&
				currentState.selected.includes(cell));

			if (!isSelected) {
				instance.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
			}
		}

		// Execute the command (without passing cell as argument)
		commandService.executeCommand(action.commandId);
	};

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
			<ActionButton
				key={action.commandId}
				ariaLabel={action.commandId} // TODO: Use CommandCenter.title when available
				onPressed={() => handleActionClick(action)}
			>
				<div className={`button-icon codicon ${action.icon}`} />
			</ActionButton>
		))}

		{/* Dropdown menu for additional actions - only render if there are menu actions */}
		{hasMenuActions ? (
			<NotebookCellMoreActionsMenu
				cell={cell}
				commandService={commandService}
				instance={instance}
				onMenuStateChange={setIsMenuOpen}
			/>
		) : null}
	</div>;
}

