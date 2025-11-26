/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../../nls.js';

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
		return nls.localize('positronHistory.older', "Older");
	}

	const monthNames = [
		nls.localize('positronHistory.january', "January"),
		nls.localize('positronHistory.february', "February"),
		nls.localize('positronHistory.march', "March"),
		nls.localize('positronHistory.april', "April"),
		nls.localize('positronHistory.may', "May"),
		nls.localize('positronHistory.june', "June"),
		nls.localize('positronHistory.july', "July"),
		nls.localize('positronHistory.august', "August"),
		nls.localize('positronHistory.september', "September"),
		nls.localize('positronHistory.october', "October"),
		nls.localize('positronHistory.november', "November"),
		nls.localize('positronHistory.december', "December")
	];

	const month = date.getMonth();
	const year = date.getFullYear();

	// Additional validation - but allow dates before 1970 as they could be valid historical data
	if (month < 0 || month > 11 || isNaN(year)) {
		return nls.localize('positronHistory.older', "Older");
	}

	return `${monthNames[month]} ${year}`;
}

/**
 * Get the section label for a given timestamp
 */
export function getSectionLabel(timestamp: number, currentDate: Date = new Date()): string {
	// Handle invalid/missing timestamps (NaN, undefined, null, or 0 which we use for unknown dates)
	if (timestamp === undefined || timestamp === null || !isFinite(timestamp) || isNaN(timestamp) || timestamp === 0) {
		return nls.localize('positronHistory.older', "Older");
	}

	const entryDate = new Date(timestamp);

	// Validate the date is valid
	if (isNaN(entryDate.getTime())) {
		return nls.localize('positronHistory.older', "Older");
	}

	const startOfToday = getStartOfDay(currentDate);
	const startOfYesterday = getStartOfYesterday(currentDate);
	const startOfLastWeek = getStartOfLastWeek(currentDate);

	let label;
	if (entryDate >= startOfToday) {
		label = nls.localize('positronHistory.today', "Today");
	} else if (entryDate >= startOfYesterday) {
		label = nls.localize('positronHistory.yesterday', "Yesterday");
	} else if (entryDate >= startOfLastWeek) {
		label = nls.localize('positronHistory.lastWeek', "Last week");
	} else {
		label = formatMonthYear(entryDate);
	}

	return label;
}

/**
 * Check if two timestamps belong to the same section
 */
export function isSameSection(timestamp1: number, timestamp2: number, currentDate: Date = new Date()): boolean {
	return getSectionLabel(timestamp1, currentDate) === getSectionLabel(timestamp2, currentDate);
}
