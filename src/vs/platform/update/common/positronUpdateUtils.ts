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
 * Parses a stored record's JSON back into a record. Returns undefined for a
 * missing, corrupt, or structurally invalid value so callers can treat "nothing
 * usable stored" uniformly.
 * @param stored The raw stored record JSON, or undefined if none is stored.
 * @returns The parsed record, or undefined.
 */
export function parseActiveLanguageRecord(stored: string | undefined): IActiveLanguageRecord | undefined {
	if (!stored) {
		return undefined;
	}
	try {
		const record = JSON.parse(stored) as IActiveLanguageRecord;
		if (typeof record?.day === 'string' && Array.isArray(record?.languages)) {
			return record;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * Merges the languages used into the stored record for today, returning the JSON
 * to persist. Multiple windows share one main-process update service and each
 * pushes only its own languages, so this unions with the existing same-day
 * record rather than overwriting (e.g. R in one window and Python in another
 * both count toward today). A stored record from an earlier day is reset rather
 * than extended, so today's report reflects only today's usage. Returns
 * undefined when the merged set is empty, so a usage-free push never overwrites
 * (clobbers) a previously stored day's languages.
 * @param stored The raw stored record JSON, or undefined if none is stored.
 * @param languages The languages to merge in, or an empty array.
 * @param now The current time in milliseconds since the epoch.
 * @returns The JSON string to store, or undefined if there is nothing to store.
 */
export function mergeActiveLanguageRecord(
	stored: string | undefined,
	languages: string[],
	now: number
): string | undefined {
	const today = toUtcDay(now);
	const existing = parseActiveLanguageRecord(stored);
	const merged = new Set<string>(existing?.day === today ? existing.languages : []);
	for (const language of languages) {
		merged.add(language);
	}
	if (merged.size === 0) {
		return undefined;
	}
	const record: IActiveLanguageRecord = { day: today, languages: [...merged].sort() };
	return JSON.stringify(record);
}
