/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';

/**
 * Format cell duration for display
 * @param duration Duration in milliseconds
 * @returns Formatted duration string
 */
export function formatCellDuration(duration: number): string {
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
export function formatTimestamp(timestamp: number): string {
	const date = new Date(timestamp);
	return date.toLocaleTimeString();
}

/**
 * Check if timestamp was more than 1 hour ago
 * @param timestamp Unix timestamp in milliseconds
 * @returns True if more than 1 hour ago
 */
export function isMoreThanOneHourAgo(timestamp: number): boolean {
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
export function getRelativeTime(timestamp: number): string {
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
			? localize('cellExecution.minuteAgo', '1 min ago')
			: localize('cellExecution.minutesAgo', '{0} mins ago', minutes);
	} else {
		return localize('cellExecution.justNow', 'Just now');
	}
}
