/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../../nls.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { showCustomContextMenu } from '../../../../../../workbench/browser/positronComponents/customContextMenu/customContextMenu.js';
import { IPositronNotebookInstance } from '../../../../../services/positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookCell } from '../../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { CellActionButton } from './CellActionButton.js';
import { buildMoreActionsMenuItems } from './actionBarMenuItems.js';
import { INotebookCellActionBarItem } from './actionBarRegistry.js';

interface NotebookCellMoreActionsMenuProps {
	instance: IPositronNotebookInstance;
	commandService: ICommandService;
	cell: IPositronNotebookCell;
	menuActions: INotebookCellActionBarItem[];
	onMenuStateChange: (isOpen: boolean) => void;
}

/**
 * More actions dropdown menu component for notebook cells.
 * Encapsulates all dropdown menu logic including state management and menu display.
 */
export function NotebookCellMoreActionsMenu({
	instance,
	commandService,
	cell,
	menuActions,
	onMenuStateChange
}: NotebookCellMoreActionsMenuProps) {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const [isMenuOpen, setIsMenuOpen] = React.useState(false);

	const showMoreActionsMenu = () => {
		if (!buttonRef.current) {
			return;
		}

		try {
			const entries = buildMoreActionsMenuItems(instance, commandService, cell, menuActions);

			setIsMenuOpen(true);
			onMenuStateChange(true);

			showCustomContextMenu({
				anchorElement: buttonRef.current,
				popupPosition: 'auto',
				popupAlignment: 'auto',
				width: 'auto',
				entries,
				onClose: () => {
					setIsMenuOpen(false);
					onMenuStateChange(false);
				}
			});
		} catch (error) {
			// If the menu fails to show for whatever reason, make sure we don't
			// get stuck in a bad state.
			setIsMenuOpen(false);
			onMenuStateChange(false);
		}
	};

	return (
		<CellActionButton
			ariaExpanded={isMenuOpen}
			ariaHasPopup='menu'
			ariaLabel={localize('moreActions', 'More actions')}
			buttonRef={buttonRef}
			onPressed={showMoreActionsMenu}
		>
			<div className='button-icon codicon codicon-ellipsis' />
		</CellActionButton>
	);
}
