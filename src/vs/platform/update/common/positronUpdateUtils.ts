/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Builds the update check URL with optional query parameters for language and telemetry reporting.
 * @param baseUrl The base URL for the update check
 * @param languages Array of active languages (e.g., ['python', 'r'])
 * @param includeLanguages Whether to include language parameters
 * @param anonymousId The anonymous telemetry ID, or undefined to omit
 * @returns The complete URL with query parameters
 */
export function buildUpdateUrl(
	baseUrl: string,
	languages: string[],
	includeLanguages: boolean,
	anonymousId: string | undefined
): string {
	const urlParams: string[] = [];
	if (includeLanguages && languages.length > 0) {
		urlParams.push(...languages.map(lang => `${lang}=1`));
	}
	if (anonymousId) {
		urlParams.push(`uuid=${anonymousId}`);
	}
	return urlParams.length > 0 ? `${baseUrl}?${urlParams.join('&')}` : baseUrl;
}

/**
 * A persisted record of the languages the user ran code in on a given UTC day.
 * Reported on the next update check so usage survives short sessions and cold
 * starts (the check often fires before any code has run in the current session).
 */
export interface IActiveLanguageRecord {
	/** The UTC day the languages were used, as 'YYYY-MM-DD'. */
	day: string;
	/** The language ids used that day, e.g. ['python', 'r']. */
	languages: string[];
}

/**
 * Formats a timestamp as its UTC day string ('YYYY-MM-DD').
 * @param timestamp Milliseconds since the epoch.
 * @returns The UTC day, e.g. '2026-07-11'.
 */
export function toUtcDay(timestamp: number): string {
	return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * Determines which languages to report on an update check from a persisted
 * record. The record's languages are reported only if its day is within
 * `maxAgeDays` of today (UTC); a missing, malformed, or stale record reports
 * nothing.
 * @param record The persisted record, or undefined if none is stored.
 * @param now The current time in milliseconds since the epoch.
 * @param maxAgeDays The oldest a record's day may be and still be reported.
 * @returns The languages to report, or an empty array.
 */
export function reportableLanguages(
	record: IActiveLanguageRecord | undefined,
	now: number,
	maxAgeDays: number
): string[] {
	if (!record?.languages?.length) {
		return [];
	}
	const recordDayMs = Date.parse(`${record.day}T00:00:00Z`);
	if (Number.isNaN(recordDayMs)) {
		return [];
	}
	const todayMs = new Date(now).setUTCHours(0, 0, 0, 0);
	const ageDays = Math.round((todayMs - recordDayMs) / (24 * 60 * 60 * 1000));
	return ageDays < 0 || ageDays > maxAgeDays ? [] : record.languages;
}

/**
 * Serializes the languages used today into a storable record, for persisting
 * across launches. Returns undefined for an empty set so a day with no usage
 * yet never overwrites (clobbers) a previously stored day's languages.
 * @param languages The languages used today, or an empty array.
 * @param now The current time in milliseconds since the epoch.
 * @returns The JSON string to store, or undefined if there is nothing to store.
 */
export function serializeActiveLanguageRecord(languages: string[], now: number): string | undefined {
	if (languages.length === 0) {
		return undefined;
	}
	const record: IActiveLanguageRecord = { day: toUtcDay(now), languages };
	return JSON.stringify(record);
}

/**
 * Resolves the languages to report on an update check: the current session's
 * usage if any code has run today, otherwise the most recent stored day within
 * the retention window. This lets the check carry a faithful signal even at cold
 * start, when it typically fires before any code has run this session.
 * @param activeLanguages The languages used so far in the current session today.
 * @param stored The raw stored record JSON, or undefined if none is stored.
 * @param now The current time in milliseconds since the epoch.
 * @param maxAgeDays The oldest a stored day may be and still be reported.
 * @returns The languages to report, or an empty array.
 */
export function resolveReportableLanguages(
	activeLanguages: string[],
	stored: string | undefined,
	now: number,
	maxAgeDays: number
): string[] {
	if (activeLanguages.length > 0) {
		return activeLanguages;
	}
	if (!stored) {
		return [];
	}
	let record: IActiveLanguageRecord;
	try {
		record = JSON.parse(stored) as IActiveLanguageRecord;
	} catch {
		return [];
	}
	return reportableLanguages(record, now, maxAgeDays);
}
