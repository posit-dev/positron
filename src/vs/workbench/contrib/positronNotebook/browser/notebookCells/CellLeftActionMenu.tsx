/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellLeftActionMenu.css';

// React.
import React, { useRef, useState, useCallback } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { useObservedValue } from '../useObservedValue.js';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell.js';
import { CellExecutionInfoPopup } from './CellExecutionInfoPopup.js';
import { Popover } from '../../../../browser/positronComponents/popover/popover.js';
import { useActionsForCell } from './actionBar/useActionsForCell.js';
import { CellSelectionStatus } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { ExecutionStatusBadge } from './ExecutionStatusBadge.js';
import { CellActionButton } from './actionBar/CellActionButton.js';

interface CellLeftActionMenuProps {
	cell: PositronNotebookCodeCell;
}

const POPUP_DELAY = 100;

/**
 * Left-side action menu for notebook cells that dynamically displays either:
 * - Execution status badges ([1], [2], etc.) when idle
 * - Action buttons (play, stop, etc.) when selected or hovered
 * - Execution info popup on hover with timing details
 */
export function CellLeftActionMenu({ cell }: CellLeftActionMenuProps) {
	// Reference hooks.
	const containerRef = useRef<HTMLDivElement>(null);
	const hoverTimeoutIdRef = useRef<number | null>(null);
	const actionsForCell = useActionsForCell(cell);
	const leftActions = actionsForCell.left;
	const primaryLeftAction = leftActions.at(0);

	// State hooks.
	const [showPopup, setShowPopup] = useState(false);
	const [isHovered, setIsHovered] = useState(false);

	// Observed values for status display and popup
	const selectionStatus = useObservedValue(cell.selectionStatus);
	const executionOrder = useObservedValue(cell.lastExecutionOrder);
	const lastRunSuccess = useObservedValue(cell.lastRunSuccess);
	const executionStatus = useObservedValue(cell.executionStatus);
	const duration = useObservedValue(cell.lastExecutionDuration);
	const lastRunEndTime = useObservedValue(cell.lastRunEndTime);

	// Derived state
	const isRunning = executionStatus === 'running';
	const showPending = executionOrder === undefined;
	const isSelected = selectionStatus !== CellSelectionStatus.Unselected;

	// Icon hover handlers for popup
	const handleMouseEnter = useCallback(() => {
		setIsHovered(true);
		if (!showPopup && containerRef.current) {
			const targetWindow = DOM.getWindow(containerRef.current);
			const timeoutId = targetWindow.setTimeout(() => {
				setShowPopup(true);
			}, POPUP_DELAY);

			hoverTimeoutIdRef.current = timeoutId;
		}
	}, [showPopup]);

	const handleMouseLeave = useCallback(() => {
		setIsHovered(false);
		// Clear the hover timeout if we leave before the popup shows
		if (hoverTimeoutIdRef.current !== null && containerRef.current) {
			const targetWindow = DOM.getWindow(containerRef.current);
			targetWindow.clearTimeout(hoverTimeoutIdRef.current);
			hoverTimeoutIdRef.current = null;
		}
		// Note: The popup will handle its own auto-close behavior
	}, []);


	const dataExecutionStatus = executionStatus || 'idle';

	const actionMenu = (isSelected || isHovered) && primaryLeftAction ? (
		<div className={`action-button-wrapper ${isRunning ? 'running' : ''}`}>
			<CellActionButton action={primaryLeftAction} cell={cell} />
		</div>
	) : null;

	return (
		<>
			{/* Main container for left-hand action menu */}
			<div
				ref={containerRef}
				className='left-hand-action-container'
				data-execution-status={dataExecutionStatus}
				onMouseEnter={handleMouseEnter}
				onMouseLeave={handleMouseLeave}
			>
				<div
					aria-label={isRunning ? 'Cell is executing' : 'Cell execution status indicator'}
					aria-live={isRunning ? 'polite' : 'off'}
					className='cell-execution-status-animation'
					role='status'
				/>
				<ExecutionStatusBadge
					cellSelected={isSelected}
					executionOrder={executionOrder}
					executionStatus={dataExecutionStatus}
					isHovered={isHovered}
					showPending={showPending}
				/>
				{actionMenu}
			</div>
			{showPopup && containerRef.current && (
				<Popover
					anchorElement={containerRef.current}
					autoCloseDelay={POPUP_DELAY}
					autoCloseOnMouseLeave={true}
					onClose={() => setShowPopup(false)}
				>
					<CellExecutionInfoPopup
						duration={duration}
						executionOrder={executionOrder}
						executionStatus={executionStatus}
						lastRunEndTime={lastRunEndTime}
						lastRunSuccess={lastRunSuccess}
					/>
				</Popover>
			)}
		</>
	);
}
