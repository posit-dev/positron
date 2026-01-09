/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useRef, useState, useCallback } from 'react';

// Other dependencies.
import { disposableTimeout } from '../../../../../base/common/async.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { CellExecutionInfoPopup } from './CellExecutionInfoPopup.js';
import { Popover } from '../../../../browser/positronComponents/popover/popover.js';

interface ExecutionStatusBadgeProps {
	/** Execution order number to display (e.g., 1, 2, 3) */
	executionOrder?: number;
	/** Whether to show the pending state (-) */
	showPending: boolean;
	/** Whether the cell has an error */
	hasError: boolean;
	/** Duration of last execution in milliseconds */
	duration?: number;
	/** Timestamp of last run end time */
	lastRunEndTime?: number;
	/** Whether the last run was successful */
	lastRunSuccess?: boolean;
	/** Current execution status */
	executionStatus?: string;
}

const POPUP_DELAY = 100;

/**
 * Component that displays execution order badges like [1], [2], or [-] for pending cells.
 * Includes a hover-triggered popover showing execution timing details.
 * Always renders a wrapper element for consistent hover targeting, even when badge content is empty.
 */
export function ExecutionStatusBadge({
	executionOrder,
	showPending,
	hasError,
	duration,
	lastRunEndTime,
	lastRunSuccess,
	executionStatus
}: ExecutionStatusBadgeProps) {
	// Reference hooks.
	const containerRef = useRef<HTMLDivElement>(null);
	const hoverTimeoutRef = useRef<IDisposable | null>(null);

	// State hooks.
	const [showPopup, setShowPopup] = useState(false);

	// Hover handlers for popup
	const handleMouseEnter = useCallback(() => {
		if (!showPopup) {
			hoverTimeoutRef.current = disposableTimeout(() => {
				setShowPopup(true);
			}, POPUP_DELAY);
		}
	}, [showPopup]);

	const handleMouseLeave = useCallback(() => {
		// Clear the hover timeout if we leave before the popup shows
		hoverTimeoutRef.current?.dispose();
		hoverTimeoutRef.current = null;
		// Note: The popup will handle its own auto-close behavior
	}, []);

	// Render badge content based on state
	const renderBadgeContent = () => {
		if (showPending) {
			return <span className='execution-order-badge'>-</span>;
		}

		if (executionOrder !== undefined) {
			return (
				<div className='execution-order-badge-container' data-has-error={hasError}>
					<span className='execution-order-badge-bracket'>[</span>
					<span className='execution-order-badge'> {String(executionOrder)} </span>
					<span className='execution-order-badge-bracket'>]</span>
				</div>
			);
		}

		return null;
	};

	return (
		<>
			<div
				ref={containerRef}
				className='execution-status-badge-wrapper'
				onMouseEnter={handleMouseEnter}
				onMouseLeave={handleMouseLeave}
			>
				{renderBadgeContent()}
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
