/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Get the start of the current day (midnight)
 */
function getStartOfDay(date: Date): Date {
	const result = new Date(date);
	result.setHours(0, 0, 0, 0);
	return result;
}

/**
 * Get the start of yesterday
 */
function getStartOfYesterday(currentDate: Date): Date {
	const yesterday = new Date(currentDate);
	yesterday.setDate(yesterday.getDate() - 1);
	return getStartOfDay(yesterday);
}

/**
 * Get the start of 7 days ago
 */
function getStartOfLastWeek(currentDate: Date): Date {
	const lastWeek = new Date(currentDate);
	lastWeek.setDate(lastWeek.getDate() - 7);
	return getStartOfDay(lastWeek);
}

/**
 * Format a date as "Month Year" (e.g., "November 2025")
 */
function formatMonthYear(date: Date): string {
	// Validate the date first
	if (isNaN(date.getTime())) {
		return 'Older';
	}

	const monthNames = [
		'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December'
	];

	const month = date.getMonth();
	const year = date.getFullYear();

	// Additional validation - but allow dates before 1970 as they could be valid historical data
	if (month < 0 || month > 11 || isNaN(year)) {
		return 'Older';
	}

	return `${monthNames[month]} ${year}`;
}

/**
 * Get the section label for a given timestamp
 */
export function getSectionLabel(timestamp: number, currentDate: Date = new Date()): string {
	// Debug logging
	console.log('[HistoryGrouping] getSectionLabel called with:', {
		timestamp,
		timestampType: typeof timestamp,
		isNaN: isNaN(timestamp),
		isFinite: isFinite(timestamp),
		currentDate: currentDate.toISOString()
	});

	// Handle invalid/missing timestamps (NaN, undefined, null, or 0 which we use for unknown dates)
	if (timestamp === undefined || timestamp === null || !isFinite(timestamp) || isNaN(timestamp) || timestamp === 0) {
		console.log('[HistoryGrouping] Invalid timestamp detected, returning Older');
		return 'Older';
	}

	const entryDate = new Date(timestamp);
	console.log('[HistoryGrouping] Created date:', {
		entryDate: entryDate.toISOString(),
		entryDateTime: entryDate.getTime()
	});

	// Validate the date is valid
	if (isNaN(entryDate.getTime())) {
		console.log('[HistoryGrouping] Invalid date after parsing, returning Older');
		return 'Older';
	}

	const startOfToday = getStartOfDay(currentDate);
	const startOfYesterday = getStartOfYesterday(currentDate);
	const startOfLastWeek = getStartOfLastWeek(currentDate);

	console.log('[HistoryGrouping] Comparison dates:', {
		startOfToday: startOfToday.toISOString(),
		startOfYesterday: startOfYesterday.toISOString(),
		startOfLastWeek: startOfLastWeek.toISOString()
	});

	let label;
	if (entryDate >= startOfToday) {
		label = 'Today';
	} else if (entryDate >= startOfYesterday) {
		label = 'Yesterday';
	} else if (entryDate >= startOfLastWeek) {
		label = 'Last week';
	} else {
		label = formatMonthYear(entryDate);
	}

	console.log('[HistoryGrouping] Returning label:', label);
	return label;
}

/**
 * Check if two timestamps belong to the same section
 */
export function isSameSection(timestamp1: number, timestamp2: number, currentDate: Date = new Date()): boolean {
	return getSectionLabel(timestamp1, currentDate) === getSectionLabel(timestamp2, currentDate);
}
