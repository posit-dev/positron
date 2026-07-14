/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { buildUpdateUrl, IActiveLanguageRecord, mergeActiveLanguageRecord, parseActiveLanguageRecord, reportableLanguages } from '../../common/positronUpdateUtils.js';

describe('buildUpdateUrl', function () {
	const baseUrl = 'https://updates.example.com/releases/darwin/arm64/releases.json';

	describe('with no optional parameters', function () {
		it('returns base URL unchanged when no languages and no anonymous ID', () => {
			const result = buildUpdateUrl(baseUrl, [], false, undefined);
			expect(result).toBe(baseUrl);
		});

		it('returns base URL unchanged when languages disabled even with languages present', () => {
			const result = buildUpdateUrl(baseUrl, ['python', 'r'], false, undefined);
			expect(result).toBe(baseUrl);
		});

		it('returns base URL unchanged when languages enabled but empty', () => {
			const result = buildUpdateUrl(baseUrl, [], true, undefined);
			expect(result).toBe(baseUrl);
		});
	});

	describe('with language parameters', function () {
		it('includes single language parameter', () => {
			const result = buildUpdateUrl(baseUrl, ['python'], true, undefined);
			expect(result).toBe(`${baseUrl}?python=1`);
		});

		it('includes multiple language parameters', () => {
			const result = buildUpdateUrl(baseUrl, ['python', 'r'], true, undefined);
			expect(result).toBe(`${baseUrl}?python=1&r=1`);
		});
	});

	describe('with anonymous ID parameter', function () {
		it('includes uuid parameter when anonymous ID provided', () => {
			const anonymousId = '12345678-1234-1234-1234-123456789012';
			const result = buildUpdateUrl(baseUrl, [], false, anonymousId);
			expect(result).toBe(`${baseUrl}?uuid=${anonymousId}`);
		});

		it('does not include uuid parameter when anonymous ID is undefined', () => {
			const result = buildUpdateUrl(baseUrl, [], false, undefined);
			expect(result).toBe(baseUrl);
		});
	});

	describe('with both languages and anonymous ID', function () {
		it('includes both language and uuid parameters', () => {
			const anonymousId = '12345678-1234-1234-1234-123456789012';
			const result = buildUpdateUrl(baseUrl, ['python', 'r'], true, anonymousId);
			expect(result).toBe(`${baseUrl}?python=1&r=1&uuid=${anonymousId}`);
		});

		it('languages come before uuid in query string', () => {
			const anonymousId = '12345678-1234-1234-1234-123456789012';
			const result = buildUpdateUrl(baseUrl, ['python'], true, anonymousId);
			expect(result.indexOf('python=1'), 'language should come before uuid').toBeLessThan(result.indexOf('uuid='));
		});
	});
});

describe('reportableLanguages', function () {
	const maxAgeDays = 7;
	// A fixed "now" so age math is deterministic.
	const now = Date.parse('2026-07-11T09:00:00Z');

	it('returns the languages when the record is from yesterday', () => {
		// The core design intent: report the last active day at cold start.
		const record: IActiveLanguageRecord = { day: '2026-07-10', languages: ['python'] };
		expect(reportableLanguages(record, now, maxAgeDays)).toEqual(['python']);
	});

	it('returns the languages at exactly the max age boundary', () => {
		const record: IActiveLanguageRecord = { day: '2026-07-04', languages: ['r'] };
		expect(reportableLanguages(record, now, maxAgeDays)).toEqual(['r']);
	});

	it('returns empty when the record is older than the max age', () => {
		const record: IActiveLanguageRecord = { day: '2026-07-03', languages: ['python'] };
		expect(reportableLanguages(record, now, maxAgeDays)).toEqual([]);
	});

	it('returns empty when the record is undefined', () => {
		expect(reportableLanguages(undefined, now, maxAgeDays)).toEqual([]);
	});

	it('returns empty when the record day is malformed', () => {
		const record: IActiveLanguageRecord = { day: 'not-a-date', languages: ['python'] };
		expect(reportableLanguages(record, now, maxAgeDays)).toEqual([]);
	});
});

// The read/write decision the update service delegates to. These exercise the
// same logic getReportableLanguages / updateActiveLanguages run, without the
// electron-main service's dependency graph and constructor side effects.
describe('active-language reporting (service logic)', function () {
	const maxAgeDays = 7;
	const now = Date.parse('2026-07-11T09:00:00Z');

	describe('mergeActiveLanguageRecord', function () {
		it('stores the day and languages for a non-empty set', () => {
			const stored = mergeActiveLanguageRecord(undefined, ['python', 'r'], now);
			expect(JSON.parse(stored!)).toEqual({ day: '2026-07-11', languages: ['python', 'r'] });
		});

		it('does not store an empty set, so a usage-free day cannot clobber a stored day', () => {
			expect(mergeActiveLanguageRecord(undefined, [], now)).toBeUndefined();
		});

		it('unions a new language into the same day (e.g. R and Python in separate windows)', () => {
			// One window reports R, another reports Python on the same day; both count.
			const afterR = mergeActiveLanguageRecord(undefined, ['r'], now);
			const afterPython = mergeActiveLanguageRecord(afterR, ['python'], now);
			expect(JSON.parse(afterPython!)).toEqual({ day: '2026-07-11', languages: ['python', 'r'] });
		});

		it('preserves the stored day when a window reports nothing', () => {
			const afterR = mergeActiveLanguageRecord(undefined, ['r'], now);
			expect(mergeActiveLanguageRecord(afterR, [], now)).toEqual(afterR);
		});

		it('resets to only the new day when the stored record is from an earlier day', () => {
			const yesterday = mergeActiveLanguageRecord(undefined, ['r'], now);
			const nextDay = Date.parse('2026-07-12T09:00:00Z');
			const today = mergeActiveLanguageRecord(yesterday, ['python'], nextDay);
			expect(JSON.parse(today!)).toEqual({ day: '2026-07-12', languages: ['python'] });
		});
	});

	describe('parseActiveLanguageRecord', function () {
		it('returns undefined when nothing is stored', () => {
			expect(parseActiveLanguageRecord(undefined)).toBeUndefined();
		});

		it('returns undefined when the stored record is corrupt JSON', () => {
			expect(parseActiveLanguageRecord('{not valid json')).toBeUndefined();
		});

		it('returns undefined when the stored record is missing required fields', () => {
			expect(parseActiveLanguageRecord('{"day":"2026-07-11"}')).toBeUndefined();
		});
	});

	it('round-trips a stored day into the next launch report', () => {
		// Session 1 persists today's usage; session 2 launches the next day with no
		// live usage yet and reports what was stored.
		const stored = mergeActiveLanguageRecord(undefined, ['python', 'r'], now);
		const nextDay = Date.parse('2026-07-12T09:00:00Z');
		expect(reportableLanguages(parseActiveLanguageRecord(stored), nextDay, maxAgeDays)).toEqual(['python', 'r']);
	});
});
