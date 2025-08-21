/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookCellActionBar.css';

// React.
import React, { useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { CustomContextMenuItem } from '../../../../../workbench/browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { CustomContextMenuSeparator } from '../../../../../workbench/browser/positronComponents/customContextMenu/customContextMenuSeparator.js';
import { CustomContextMenuEntry, showCustomContextMenu } from '../../../../../workbench/browser/positronComponents/customContextMenu/customContextMenu.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { IPositronNotebookCell, CellSelectionStatus } from '../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { IPositronNotebookInstance } from '../../../../services/positronNotebook/browser/IPositronNotebookInstance.js';
import { ActionButton } from '../utilityComponents/ActionButton.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { useSelectionStatus } from './useSelectionStatus.js';

/**
 * Simple dropdown menu button component that properly handles refs for positioning.
 * This is a minimal button specifically for the notebook cell dropdown menu.
 */
interface DropdownMenuButtonProps {
	ariaLabel: string;
	buttonRef: React.RefObject<HTMLButtonElement>;
	onClick: () => void;
	children: React.ReactNode;
}

function DropdownMenuButton({ ariaLabel, buttonRef, onClick, children }: DropdownMenuButtonProps) {
	return (
		<Button
			ref={buttonRef}
			ariaLabel={ariaLabel}
			className='action action-button'
			onPressed={onClick}
		>
			{children}
		</Button>
	);
}

interface NotebookCellActionBarProps {
	cell: IPositronNotebookCell;
	children: React.ReactNode;
	isHovered?: boolean;
}

export function NotebookCellActionBar({ cell, children, isHovered = false }: NotebookCellActionBarProps) {
	const services = usePositronReactServicesContext();
	const commandService = services.commandService;
	const instance = useNotebookInstance();
	const moreActionsButtonRef = useRef<HTMLButtonElement>(null);
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const selectionStatus = useSelectionStatus(cell);

	// Compute whether action bar should be visible
	const shouldShowActionBar = isMenuOpen || isHovered ||
		selectionStatus === CellSelectionStatus.Selected ||
		selectionStatus === CellSelectionStatus.Editing;

	const showMoreActionsMenu = async () => {
		if (!moreActionsButtonRef.current) {
			console.warn('NotebookCellActionBar: No button ref available');
			return;
		}

		const entries = getMoreActions(instance, commandService);
		console.log('NotebookCellActionBar: Showing menu with entries:', entries);

		setIsMenuOpen(true);
		try {
			await showCustomContextMenu({
				anchorElement: moreActionsButtonRef.current,
				popupPosition: 'auto',
				popupAlignment: 'auto',
				width: 'auto',
				entries
			});
		} finally {
			setIsMenuOpen(false);
		}
	};

	return <div
		className={`positron-notebooks-cell-action-bar ${shouldShowActionBar ? 'visible' : 'hidden'}`}
	>
		{children}
		<DropdownMenuButton
			ariaLabel={(() => localize('moreActions', 'More actions'))()}
			buttonRef={moreActionsButtonRef}
			onClick={showMoreActionsMenu}
		>
			<div className='button-icon codicon codicon-ellipsis' />
		</DropdownMenuButton>
		<ActionButton
			ariaLabel={(() => localize('deleteCell', 'Delete cell'))()}
			onPressed={() => cell.delete()}
		>
			<div className='button-icon codicon codicon-trash' />
		</ActionButton>
	</div>;
}

/**
 * Get the menu entries to show in the "more actions" dropdown menu.
 * This provides a clean extension point for adding new actions.
 */
function getMoreActions(instance: IPositronNotebookInstance, commandService: ICommandService): CustomContextMenuEntry[] {
	const entries: CustomContextMenuEntry[] = [];

	// Copy cell action
	entries.push(new CustomContextMenuItem({
		commandId: 'positronNotebook.copyCells',
		label: localize('copyCell', 'Copy Cell'),
		icon: 'copy',
		onSelected: () => commandService.executeCommand('positronNotebook.copyCells')
	}));

	// Cut cell action (only if not read-only)
	if (!instance.isReadOnly) {
		entries.push(new CustomContextMenuItem({
			commandId: 'positronNotebook.cutCells',
			label: localize('cutCell', 'Cut Cell'),
			icon: 'cut',
			onSelected: () => commandService.executeCommand('positronNotebook.cutCells')
		}));
	}

	// Paste actions (only if clipboard has content and not read-only)
	if (instance.canPaste() && !instance.isReadOnly) {
		entries.push(new CustomContextMenuSeparator());
		entries.push(new CustomContextMenuItem({
			commandId: 'positronNotebook.pasteCells',
			label: localize('pasteCellBelow', 'Paste Cell Below'),
			icon: 'arrow-down',
			onSelected: () => commandService.executeCommand('positronNotebook.pasteCells')
		}));

		entries.push(new CustomContextMenuItem({
			commandId: 'positronNotebook.pasteCellsAbove',
			label: localize('pasteCellAbove', 'Paste Cell Above'),
			icon: 'arrow-up',
			onSelected: () => commandService.executeCommand('positronNotebook.pasteCellsAbove')
		}));
	}

	return entries;
}
