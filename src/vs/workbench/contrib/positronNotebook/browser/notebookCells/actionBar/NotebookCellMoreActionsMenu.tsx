/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


// CSS.
import '../../../../../../base/browser/ui/positronComponents/button/button.css';

// React.
import React, { useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../../nls.js';
import { showCustomContextMenu } from '../../../../../../workbench/browser/positronComponents/customContextMenu/customContextMenu.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { buildMoreActionsMenuItems } from './actionBarMenuItems.js';
import { INotebookCellActionBarItem } from './actionBarRegistry.js';
import { usePositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';

interface NotebookCellMoreActionsMenuProps {
	instance: IPositronNotebookInstance;
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
	cell,
	menuActions,
	onMenuStateChange
}: NotebookCellMoreActionsMenuProps) {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const [isMenuOpen, setIsMenuOpen] = React.useState(false);
	const commandService = usePositronReactServicesContext().commandService;
	const showMoreActionsMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
		// Prevent click from bubbling to cell wrapper which would deselect the cell
		e.preventDefault();
		e.stopPropagation();

		if (!buttonRef.current) {
			return;
		}

		try {
			const entries = buildMoreActionsMenuItems(commandService, menuActions);

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
		<button
			ref={buttonRef}
			aria-expanded={isMenuOpen}
			aria-haspopup='menu'
			aria-label={localize('moreActions', 'More actions')}
			className='positron-button'
			onClick={showMoreActionsMenu}
		>
			<div className='button-icon codicon codicon-ellipsis' />
		</button>
	);
}
