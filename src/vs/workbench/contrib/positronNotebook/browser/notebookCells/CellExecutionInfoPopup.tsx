/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellExecutionInfoPopup.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { useObservedValue } from '../useObservedValue.js';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell.js';

interface CellExecutionInfoPopupProps {
	cell: PositronNotebookCodeCell;
}

/**
 * Format cell duration for display
 * @param duration Duration in milliseconds
 * @returns Formatted duration string
 */
function formatCellDuration(duration: number): string {
	if (duration < 1000) {
		return `${duration}ms`;
	}

	const minutes = Math.floor(duration / 1000 / 60);
	const seconds = Math.floor(duration / 1000) % 60;
	const tenths = Math.floor((duration % 1000) / 100);

	if (minutes > 0) {
		return `${minutes}m ${seconds}.${tenths}s`;
	} else {
		return `${seconds}.${tenths}s`;
	}
}

/**
 * Format timestamp for display
 * @param timestamp Unix timestamp in milliseconds
 * @returns Formatted time string
 */
function formatTimestamp(timestamp: number): string {
	const date = new Date(timestamp);
	return date.toLocaleTimeString();
}

/**
 * Check if timestamp was more than 1 hour ago
 * @param timestamp Unix timestamp in milliseconds
 * @returns True if more than 1 hour ago
 */
function isMoreThanOneHourAgo(timestamp: number): boolean {
	const now = Date.now();
	const diff = now - timestamp;
	const hours = diff / (1000 * 60 * 60);
	return hours >= 1;
}

/**
 * Get relative time string (e.g., '2 minutes ago')
 * @param timestamp Unix timestamp in milliseconds
 * @returns Relative time string
 */
function getRelativeTime(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) {
		return days === 1
			? localize('cellExecution.dayAgo', '1 day ago')
			: localize('cellExecution.daysAgo', '{0} days ago', days);
	} else if (hours > 0) {
		return hours === 1
			? localize('cellExecution.hourAgo', '1 hour ago')
			: localize('cellExecution.hoursAgo', '{0} hours ago', hours);
	} else if (minutes > 0) {
		return minutes === 1
			? localize('cellExecution.minuteAgo', '1 minute ago')
			: localize('cellExecution.minutesAgo', '{0} minutes ago', minutes);
	} else if (seconds > 0) {
		return seconds === 1
			? localize('cellExecution.secondAgo', '1 second ago')
			: localize('cellExecution.secondsAgo', '{0} seconds ago', seconds);
	} else {
		return localize('cellExecution.justNow', 'Just now');
	}
}

export function CellExecutionInfoPopup({ cell }: CellExecutionInfoPopupProps) {
	// Use reactive hooks to observe cell state changes
	const executionOrder = useObservedValue(cell.lastExecutionOrder);
	const duration = useObservedValue(cell.lastExecutionDuration);
	const lastRunEndTime = useObservedValue(cell.lastRunEndTime);
	const lastRunSuccess = useObservedValue(cell.lastRunSuccess);
	const executionStatus = useObservedValue(cell.executionStatus);

	// Determine the data availability for various sections
	const hasExecutionOrder = executionOrder !== undefined;
	const hasExecutionResult = lastRunSuccess !== undefined;
	const isCurrentlyRunning = executionStatus === 'running';
	const hasDuration = duration !== undefined;
	const hasCompletionTime = lastRunEndTime !== undefined;
	const hasTimingInfo = hasDuration || hasCompletionTime;
	const completedMoreThanAnHourAgo =
		lastRunEndTime !== undefined && isMoreThanOneHourAgo(lastRunEndTime);

	// Check if cell has never been run
	const hasNeverBeenRun =
		!hasExecutionOrder && !hasExecutionResult && !isCurrentlyRunning;

	// If cell has never been run, show a simple message
	if (hasNeverBeenRun) {
		return (
			<div
				aria-label='Cell execution details'
				className='cell-execution-info-popup'
				role='tooltip'
			>
				<div className='popup-row'>
					<span className='popup-label'>
						{localize('cellExecution.notYetRun', 'Cell not yet run')}
					</span>
				</div>
			</div>
		);
	}

	return (
		<div
			aria-label='Cell execution details'
			className='cell-execution-info-popup'
			role='tooltip'
		>
			{/* Popup body: lists high-level status then timing metadata */}
			{/* Status Section */}
			{hasExecutionOrder && (
				<div aria-label='Execution order' className='popup-row'>
					{/* Execution order row: shows the cell's execution sequence number when available */}
					<span className='popup-icon codicon codicon-play'></span>
					<span className='popup-label-text'>
						{localize('cellExecution.order.label', 'Execution order:')}
					</span>
					<span className='popup-value-text'>{executionOrder}</span>
				</div>
			)}
			{hasExecutionResult && (
				<div aria-label='Execution status' className='popup-row'>
					{/* Execution result row: success/failure indicator with icon and label */}
					<span
						aria-label={
							lastRunSuccess ? 'Execution succeeded' : 'Execution failed'
						}
						className={`popup-icon codicon ${lastRunSuccess ? 'codicon-pass' : 'codicon-error'
							}`}
						role='img'
					></span>
					<span className='popup-label-text'>
						{localize('cellExecution.status.label', 'Status:')}
					</span>
					<span
						aria-label={
							lastRunSuccess ? 'Execution succeeded' : 'Execution failed'
						}
						className={`popup-value-text ${lastRunSuccess ? 'popup-label-success' : 'popup-label-failed'
							}`}
					>
						{lastRunSuccess
							? localize('cellExecution.success', 'Success')
							: localize('cellExecution.failed', 'Failed')}
					</span>
				</div>
			)}
			{isCurrentlyRunning && (
				<div className='popup-row'>
					{/* Running row: spinner and text shown only while a cell is currently executing */}
					<span
						aria-label='Cell is executing'
						className='popup-icon codicon codicon-sync codicon-modifier-spin'
						role='img'
					></span>
					<span className='popup-label'>
						{localize('cellExecution.running', 'Currently running...')}
					</span>
				</div>
			)}

			{/* Separator between status and timing information */}
			{hasTimingInfo && (
				<div className='popup-separator'>
					{/* Visual divider separating status rows from timing rows */}
				</div>
			)}

			{/* Timing Section */}
			{hasDuration && (
				<div aria-label='Execution duration' className='popup-row'>
					{/* Duration row: displays formatted run time (e.g., 2.3s or 850ms) */}
					<span className='popup-icon codicon codicon-clock'></span>
					<span className='popup-label-text'>
						{localize('cellExecution.duration.label', 'Duration:')}
					</span>
					<span className='popup-value-text'>
						{duration !== undefined ? formatCellDuration(duration) : ''}
					</span>
				</div>
			)}
			{hasCompletionTime && (
				<div className='popup-row'>
					{/* Completion time row: shows relative time; if >1 hour ago, also shows absolute local time */}
					<span className='popup-icon codicon codicon-calendar'></span>
					<span className='popup-label-text'>
						{localize('cellExecution.endTime.label', 'Completed:')}
					</span>
					<span className='popup-value-text'>
						{lastRunEndTime !== undefined // for type narrowing
							? completedMoreThanAnHourAgo
								? `${getRelativeTime(lastRunEndTime)} (${formatTimestamp(lastRunEndTime)})`
								: `${getRelativeTime(lastRunEndTime)}`
							: ''}
					</span>
				</div>
			)}
		</div>
	);
}
