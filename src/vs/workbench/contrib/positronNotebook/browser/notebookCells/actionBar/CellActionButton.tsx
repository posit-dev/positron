/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './CellActionButton.css';

import { useState, useRef, useCallback } from 'react';
import { CellSelectionType } from '../../selectionMachine.js';
import { useNotebookInstance } from '../../NotebookInstanceProvider.js';
import { ActionButton } from '../../utilityComponents/ActionButton.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { MenuItemAction, SubmenuItemAction } from '../../../../../../platform/actions/common/actions.js';
import { DevErrorIcon, Icon } from '../../../../../../platform/positronActionBar/browser/components/icon.js';
import { IHoverManager } from '../../../../../../platform/hover/browser/hoverManager.js';
import { positronClassNames } from '../../../../../../base/common/positronUtilities.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { isPositronNotebookActionId, PositronNotebookActionId } from '../../../common/positronNotebookCommon.js';


interface CellActionButtonProps {
	action: MenuItemAction | SubmenuItemAction;
	cell: IPositronNotebookCell;
	hoverManager?: IHoverManager;
	showSeparator?: boolean;
}

/**
 * Action IDs that show a brief checkmark after a successful run.
 *
 * NOTE: It would be cleaner to set this in the action definition, but that would require a
 * broader change that affects all actions. We'll start in the notebook UI and consider
 * a broader change in future.
 */
const SHOW_SUCCESS_FEEDBACK = new Set([
	PositronNotebookActionId.CopyOutputImage,
]);

/** Duration to show the success feedback (in milliseconds). */
const SUCCESS_FEEDBACK_DURATION = 1500;

/**
 * Standardized action button component for notebook cell actions. Handles cell selection and command execution.
 * @param action The action to execute
 * @param cell The cell to execute the action on
 * @param hoverManager Optional hover manager for tooltip display
 * @param showSeparator Whether to show a separator after this button
 * @returns A button that executes the action when clicked.
 */
export function CellActionButton({ action, cell, hoverManager, showSeparator }: CellActionButtonProps) {
	const instance = useNotebookInstance();
	const [showSuccess, setShowSuccess] = useState(false);
	const successTimeoutRef = useRef<Timeout | undefined>(undefined);

	const handleActionClick = useCallback(async () => {
		// Actions assume cell is selected, so ensure this is the case
		instance.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);

		// Execute the command (without passing cell as argument)
		try {
			await action.run();

			// Show success feedback momentarily for opted-in actions
			if (isPositronNotebookActionId(action.id) && SHOW_SUCCESS_FEEDBACK.has(action.id)) {
				clearTimeout(successTimeoutRef.current);
				setShowSuccess(true);
				successTimeoutRef.current = setTimeout(() => setShowSuccess(false), SUCCESS_FEEDBACK_DURATION);
			}
		} catch (error) {
			console.log(error);
		}
	}, [action, cell, instance]);

	const getIcon = () => {
		if (showSuccess) {
			return <Icon icon={Codicon.check} />;
		}
		if (action.item.icon) {
			return <Icon icon={action.item.icon} />;
		}
		// Cell actions should have icons; this is a developer error
		return <DevErrorIcon />;
	};
	const icon = getIcon();

	return (
		<ActionButton
			key={action.id}
			ariaLabel={action.label}
			className={positronClassNames('cell-action-button', {
				'separator-after': showSeparator,
			})}
			hoverManager={hoverManager}
			// Match VSCode behavior: prefer tooltip but default to label
			tooltip={action.tooltip && action.tooltip.length > 0 ? action.tooltip : action.label}
			onPressed={handleActionClick}
		>
			{icon}
		</ActionButton>
	);
}
