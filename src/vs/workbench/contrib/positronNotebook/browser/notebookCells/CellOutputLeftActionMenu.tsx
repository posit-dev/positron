/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellOutputLeftActionMenu.css';

// React.
import { useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ActionButton } from '../utilityComponents/ActionButton.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell.js';
import { useObservedValue } from '../useObservedValue.js';
import { Icon } from '../../../../../platform/positronActionBar/browser/components/icon.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { useCellOutputContextMenu } from './useCellOutputContextMenu.js';

const cellOutputActions = localize('cellOutputActions', 'Cell Output Actions');

interface CellOutputLeftActionMenuProps {
	cell: PositronNotebookCodeCell;
}

/**
 * The left action menu for notebook cell output actions.
 * Uses the native context menu service to display actions registered to
 * MenuId.PositronNotebookCellOutputActionLeft.
 * @param cell The cell that the menu actions will operate on
 */
export function CellOutputLeftActionMenu({ cell }: CellOutputLeftActionMenuProps) {
	const instance = useNotebookInstance();
	const { showCellOutputContextMenu } = useCellOutputContextMenu(cell);

	const buttonRef = useRef<HTMLButtonElement>(null);
	const [isMenuOpen, setIsMenuOpen] = useState(false);

	// Check if there are outputs to determine if we should render the menu
	const outputs = useObservedValue(cell.outputs);
	const hasOutputs = outputs.length > 0;

	const handleShowContextMenu = () => {
		if (!buttonRef.current) {
			return;
		}

		setIsMenuOpen(true);
		showCellOutputContextMenu(buttonRef.current, () => setIsMenuOpen(false));
	};

	// Don't render if the cell has no outputs
	if (!hasOutputs) {
		return null;
	}

	return (
		<div className='cell-output-left-action-menu'>
			<ActionButton
				ref={buttonRef}
				aria-expanded={isMenuOpen}
				aria-haspopup='menu'
				ariaLabel={cellOutputActions}
				hoverManager={instance.hoverManager}
				tooltip={cellOutputActions}
				onPressed={handleShowContextMenu}
			>
				<Icon className='button-icon' icon={Codicon.ellipsis} />
			</ActionButton>
		</div>
	);
}
