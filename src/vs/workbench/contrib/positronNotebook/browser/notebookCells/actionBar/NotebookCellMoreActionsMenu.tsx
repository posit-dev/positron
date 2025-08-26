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

	const showMoreActionsMenu = async () => {
		if (!buttonRef.current) {
			return;
		}

		const entries = buildMoreActionsMenuItems(instance, commandService, cell, menuActions);

		onMenuStateChange(true);
		setIsMenuOpen(true);

		try {
			await showCustomContextMenu({
				anchorElement: buttonRef.current,
				popupPosition: 'auto',
				popupAlignment: 'auto',
				width: 'auto',
				entries
			});
		} finally {
			onMenuStateChange(false);
			setIsMenuOpen(false);
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
