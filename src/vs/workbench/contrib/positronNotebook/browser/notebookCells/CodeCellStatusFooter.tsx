/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CodeCellStatusFooter.css';

// React.
import React, { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { useObservedValue } from '../useObservedValue.js';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell.js';
import { formatCellDuration, formatTimestamp, getRelativeTime, isMoreThanOneHourAgo } from './cellExecutionUtils.js';
import { Icon } from '../../../../../platform/positronActionBar/browser/components/icon.js';
import { Codicon } from '../../../../../base/common/codicons.js';

interface CodeCellStatusFooterProps {
	cell: PositronNotebookCodeCell;
	hasError: boolean;
}

/**
 * Footer component that displays cell execution status information between
 * the editor and outputs sections. Shows execution state, duration, and timestamp.
 */
export function CodeCellStatusFooter({ cell, hasError }: CodeCellStatusFooterProps) {
	// Observe cell execution state
	const executionStatus = useObservedValue(cell.executionStatus);
	const executionOrder = useObservedValue(cell.lastExecutionOrder);
	const duration = useObservedValue(cell.lastExecutionDuration);
	const lastRunEndTime = useObservedValue(cell.lastRunEndTime);
	const lastRunSuccess = useObservedValue(cell.lastRunSuccess);

	/**
	 * `lastRunEndTime` doesn't change after execution completes, which means the
	 * relative time recalculation won't trigger a re-render. To keep the relative time
	 * display accurate, we set up an interval that updates a dummy state value every minute.
	 * This forces the component to re-render and update the displayed relative time.
	 */
	const [, setTick] = useState(0);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		// Only set up interval if we have a completion time to display
		if (lastRunEndTime === undefined) {
			return;
		}

		const targetWindow = DOM.getWindow(containerRef.current);
		const intervalId = targetWindow.setInterval(() => {
			// Only update if cell is visible to avoid unnecessary re-renders
			if (cell.isInViewport()) {
				setTick(tick => tick + 1);
			}
		}, 60000);

		return () => targetWindow.clearInterval(intervalId);
	}, [cell, lastRunEndTime]);

	// Derive state conditions
	const hasExecutionOrder = executionOrder !== undefined;
	const hasExecutionResult = lastRunSuccess !== undefined;
	const isCurrentlyRunning = executionStatus === 'running';
	const hasDuration = duration !== undefined;
	const hasCompletionTime = lastRunEndTime !== undefined;
	const hasTimingInfo = hasDuration || hasCompletionTime;
	const hasCurrentSessionContent = hasExecutionResult || isCurrentlyRunning || hasTimingInfo;

	// Check if cell has never been run (no execution order and no current session data)
	const hasNeverBeenRun = !hasExecutionOrder && !hasExecutionResult && !isCurrentlyRunning;

	// Check if we only have execution order from previous session (no current session data)
	const wasRunInPreviousSession = hasExecutionOrder && !hasCurrentSessionContent;

	const isPending = executionStatus === 'pending';

	const dataExecutionStatus = executionStatus || 'idle';

	const renderIcon = () => {
		if (isCurrentlyRunning) {
			return (
				<Icon
					className='code-cell-footer-icon running'
					icon={Codicon.sync}
				/>
			);
		}

		if (isPending) {
			return (
				<Icon
					className='code-cell-footer-icon pending'
					icon={Codicon.clock}
				/>
			);
		}

		if (hasTimingInfo) {
			if (hasError || lastRunSuccess === false) {
				return (
					<Icon
						className='code-cell-footer-icon error'
						icon={Codicon.error}
					/>
				);
			} else {
				return (
					<Icon
						className='code-cell-footer-icon success'
						icon={Codicon.check}
					/>
				);
			}
		}

		return null;
	};

	// Determine what text to show
	const renderText = () => {
		// Show duration and timestamp for completed cells (or previous run while currently running)
		if (hasTimingInfo && duration !== undefined && lastRunEndTime !== undefined) {
			const formattedDuration = formatCellDuration(duration);
			const completedMoreThanAnHourAgo = isMoreThanOneHourAgo(lastRunEndTime);
			const timeDisplay = completedMoreThanAnHourAgo
				? `${getRelativeTime(lastRunEndTime)} (${formatTimestamp(lastRunEndTime)})`
				: getRelativeTime(lastRunEndTime);

			return (
				<span className='code-cell-footer-text'>
					<span className='code-cell-footer-duration'>{formattedDuration}</span>
					<span>{timeDisplay}</span>
				</span>
			);
		}

		return null;
	};

	// Build ARIA label for accessibility
	const getAriaLabel = () => {
		if (hasNeverBeenRun) {
			return localize('cellExecution.notYetRun', 'Cell not yet run');
		}

		if (wasRunInPreviousSession) {
			return localize('cellExecution.notRunThisSession', 'Not run this session');
		}

		if (isCurrentlyRunning) {
			return localize('cellExecution.running', 'Cell is executing');
		}

		if (isPending) {
			return localize('cellExecution.pending', 'Cell is queued for execution');
		}

		if (hasTimingInfo && duration !== undefined && lastRunEndTime !== undefined) {
			const status = hasError || lastRunSuccess === false
				? localize('cellExecution.failed', 'Cell execution failed')
				: localize('cellExecution.success', 'Cell execution succeeded');
			const formattedDuration = formatCellDuration(duration);
			const timeDisplay = getRelativeTime(lastRunEndTime);

			return `${status}. ${formattedDuration}. ${timeDisplay}`;
		}

		return localize('cellExecution.statusIndicator', 'Cell execution status indicator');
	};

	return (
		<div
			ref={containerRef}
			aria-label={getAriaLabel()}
			aria-live={isCurrentlyRunning ? 'polite' : 'off'}
			className='positron-notebook-code-cell-footer'
			data-execution-status={dataExecutionStatus}
			role='status'
		>
			{renderIcon()}
			{renderText()}
		</div>
	);
}
