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
 * Builds the URL of the release notes markdown for a version on the update CDN.
 *
 * @param updateUrl The update CDN base URL (product.json's `updateUrl`)
 * @param channel The release channel (e.g. 'releases')
 * @param version The Positron calver version to fetch release notes for
 * @returns The complete URL of the release notes markdown file
 */
export function buildReleaseNotesUrl(updateUrl: string, channel: string, version: string): string {
	return `${updateUrl}/${channel}/release-notes/release-${version}.md`;
}

/**
 * A persisted record of the most recent UTC day each language was used.
 * Reported on the next update check so usage survives short sessions and cold
 * starts (the check often fires before any code has run in the current session).
 * Keeping a day per language, rather than one day for all languages, lets the
 * report cover every language used within the retention window, not only the
 * languages used on the most recent active day.
 */
export interface IActiveLanguageRecord {
	/** The UTC day ('YYYY-MM-DD') each language was last used, keyed by language id. */
	lastUsed: Record<string, string>;
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
 * Determines whether a UTC day is within `maxAgeDays` of today (UTC). A
 * malformed day, or a day in the future (clock skew), is not.
 * @param day The UTC day, as 'YYYY-MM-DD'.
 * @param now The current time in milliseconds since the epoch.
 * @param maxAgeDays The oldest the day may be and still count as recent.
 * @returns Whether the day is recent.
 */
function isRecentDay(day: string, now: number, maxAgeDays: number): boolean {
	const dayMs = Date.parse(`${day}T00:00:00Z`);
	if (Number.isNaN(dayMs)) {
		return false;
	}
	const todayMs = new Date(now).setUTCHours(0, 0, 0, 0);
	const ageDays = Math.round((todayMs - dayMs) / (24 * 60 * 60 * 1000));
	return ageDays >= 0 && ageDays <= maxAgeDays;
}

/**
 * Determines which languages to report on an update check from a persisted
 * record: every language last used within `maxAgeDays` of today (UTC). A
 * missing record reports nothing.
 * @param record The persisted record, or undefined if none is stored.
 * @param now The current time in milliseconds since the epoch.
 * @param maxAgeDays The oldest a language's day may be and still be reported.
 * @returns The languages to report, sorted, or an empty array.
 */
export function reportableLanguages(
	record: IActiveLanguageRecord | undefined,
	now: number,
	maxAgeDays: number
): string[] {
	if (!record) {
		return [];
	}
	return Object.entries(record.lastUsed)
		.filter(([, day]) => isRecentDay(day, now, maxAgeDays))
		.map(([language]) => language)
		.sort();
}

/**
 * Parses a stored record's JSON back into a record. Also accepts the earlier
 * `{ day, languages }` format, which recorded only the most recent active day,
 * so usage stored by an older version is still reported after an update.
 * Returns undefined for a missing, corrupt, or structurally invalid value so
 * callers can treat "nothing usable stored" uniformly.
 * @param stored The raw stored record JSON, or undefined if none is stored.
 * @returns The parsed record, or undefined.
 */
export function parseActiveLanguageRecord(stored: string | undefined): IActiveLanguageRecord | undefined {
	if (!stored) {
		return undefined;
	}
	let parsed: { day?: unknown; languages?: unknown; lastUsed?: unknown } | null | undefined;
	try {
		parsed = JSON.parse(stored);
	} catch {
		return undefined;
	}
	const legacyDay = parsed?.day;
	const legacyLanguages = parsed?.languages;
	if (typeof legacyDay === 'string' && Array.isArray(legacyLanguages)) {
		const lastUsed: Record<string, string> = {};
		for (const language of legacyLanguages) {
			if (typeof language === 'string') {
				lastUsed[language] = legacyDay;
			}
		}
		return { lastUsed };
	}
	const lastUsed = parsed?.lastUsed;
	if (typeof lastUsed !== 'object' || lastUsed === null || Array.isArray(lastUsed)) {
		return undefined;
	}
	const record: IActiveLanguageRecord = { lastUsed: {} };
	for (const [language, day] of Object.entries(lastUsed)) {
		if (typeof day === 'string') {
			record.lastUsed[language] = day;
		}
	}
	return record;
}

/**
 * Merges the languages used today into the stored record, returning the JSON
 * to persist. Each language's day is set to today, and languages not used
 * within `maxAgeDays` are dropped so the record does not grow without bound.
 * Multiple windows share one main-process update service and each pushes only
 * its own languages, so languages missing from a push keep their stored day
 * (e.g. R in one window and Python in another both count). Returns undefined
 * when there are no languages to merge, so a usage-free push never rewrites
 * the stored record.
 * @param stored The raw stored record JSON, or undefined if none is stored.
 * @param languages The languages used today, or an empty array.
 * @param now The current time in milliseconds since the epoch.
 * @param maxAgeDays The oldest a language's day may be and still be kept.
 * @returns The JSON string to store, or undefined if there is nothing to store.
 */
export function mergeActiveLanguageRecord(
	stored: string | undefined,
	languages: string[],
	now: number,
	maxAgeDays: number
): string | undefined {
	if (languages.length === 0) {
		return undefined;
	}
	const today = toUtcDay(now);
	const existing = parseActiveLanguageRecord(stored);
	const lastUsed: Record<string, string> = {};
	for (const [language, day] of Object.entries(existing?.lastUsed ?? {})) {
		if (isRecentDay(day, now, maxAgeDays)) {
			lastUsed[language] = day;
		}
	}
	for (const language of languages) {
		lastUsed[language] = today;
	}
	const record: IActiveLanguageRecord = { lastUsed: Object.fromEntries(Object.entries(lastUsed).sort()) };
	return JSON.stringify(record);
}
