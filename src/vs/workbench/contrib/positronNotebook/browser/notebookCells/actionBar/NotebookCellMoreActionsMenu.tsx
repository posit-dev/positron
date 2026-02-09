/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useRef } from 'react';

// Other dependencies.
import { showCustomContextMenu } from '../../../../../../workbench/browser/positronComponents/customContextMenu/customContextMenu.js';
import { buildMoreActionsMenuItems } from './actionBarMenuItems.js';
import { ActionButton } from '../../utilityComponents/ActionButton.js';
import { MenuItemAction, SubmenuItemAction } from '../../../../../../platform/actions/common/actions.js';
import { Icon } from '../../../../../../platform/positronActionBar/browser/components/icon.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { IHoverManager } from '../../../../../../platform/hover/browser/hoverManager.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';

interface NotebookCellMoreActionsMenuProps {
	ariaLabel: string;
	cell: IPositronNotebookCell;
	hoverManager?: IHoverManager;
	instance: IPositronNotebookInstance;
	isMenuOpen: boolean;
	menuActions: [string, (MenuItemAction | SubmenuItemAction)[]][],
	setIsMenuOpen: (isOpen: boolean) => void;
}

/**
 * More actions dropdown menu component for notebook cells.
 * Encapsulates all dropdown menu logic including state management and menu display.
 */
export function NotebookCellMoreActionsMenu({
	ariaLabel,
	cell,
	hoverManager,
	instance,
	isMenuOpen,
	menuActions,
	setIsMenuOpen,
}: NotebookCellMoreActionsMenuProps) {
	const buttonRef = useRef<HTMLButtonElement>(null);

	const showMoreActionsMenu = () => {

		if (!buttonRef.current) {
			return;
		}

		try {
			const entries = buildMoreActionsMenuItems(cell, menuActions, instance);

			setIsMenuOpen(true);

			showCustomContextMenu({
				anchorElement: buttonRef.current,
				popupPosition: 'auto',
				popupAlignment: 'auto',
				width: 'auto',
				entries,
				onClose: () => {
					setIsMenuOpen(false);
				}
			});
		} catch (error) {
			// If the menu fails to show for whatever reason, make sure we don't
			// get stuck in a bad state.
			setIsMenuOpen(false);
		}
	};

	return (
		<ActionButton
			ref={buttonRef}
			aria-expanded={isMenuOpen}
			aria-haspopup='menu'
			ariaLabel={ariaLabel}
			hoverManager={hoverManager}
			tooltip={ariaLabel}
			onPressed={showMoreActionsMenu}
		>
			<Icon className='button-icon' icon={Codicon.ellipsis} />
		</ActionButton>
	);
}
