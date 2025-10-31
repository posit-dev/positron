/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
import { ActionButton } from '../../utilityComponents/ActionButton.js';

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
	const showMoreActionsMenu = () => {

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
		<ActionButton
			ref={buttonRef}
			aria-expanded={isMenuOpen}
			aria-haspopup='menu'
			ariaLabel={localize('moreActions', 'More actions')}
			onPressed={showMoreActionsMenu}
		>
			<div className='button-icon codicon codicon-ellipsis' />
		</ActionButton>
	);
}
