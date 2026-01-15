/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CodeCellStatusFooter.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
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
		// Cell has never been run
		if (hasNeverBeenRun) {
			return (
				<span className='code-cell-footer-text'>
					{localize('cellExecution.notYetRun', 'Cell not yet run')}
				</span>
			);
		}

		// Cell was run in a previous session (has execution order but no current session data)
		if (wasRunInPreviousSession) {
			return (
				<span className='code-cell-footer-text'>
					{localize('cellExecution.notRunThisSession', 'Not run this session')}
				</span>
			);
		}

		// Show duration and timestamp for completed cells (or previous run while currently running)
		if (hasTimingInfo && duration !== undefined && lastRunEndTime !== undefined) {
			const formattedDuration = formatCellDuration(duration);
			const completedMoreThanAnHourAgo = isMoreThanOneHourAgo(lastRunEndTime);
			const timeDisplay = completedMoreThanAnHourAgo
				? `${getRelativeTime(lastRunEndTime)} (${formatTimestamp(lastRunEndTime)})`
				: getRelativeTime(lastRunEndTime);

			return (
				<span className='code-cell-footer-text'>
					<span>{formattedDuration}</span>
					<span className='code-cell-footer-separator'>|</span>
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
			return localize('cellExecution.running', 'Currently running...');
		}

		if (isPending) {
			return localize('cellExecution.pending', 'Cell is queued for execution');
		}

		if (hasTimingInfo && duration !== undefined && lastRunEndTime !== undefined) {
			const status = hasError || lastRunSuccess === false
				? localize('cellExecution.failed', 'Failed')
				: localize('cellExecution.success', 'Success');
			const formattedDuration = formatCellDuration(duration);
			const timeDisplay = getRelativeTime(lastRunEndTime);

			return `${status}. ${formattedDuration}. ${timeDisplay}`;
		}

		return '';
	};

	return (
		<div
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
