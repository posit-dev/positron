/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { buildReleaseNotesUrl, buildUpdateUrl, IActiveLanguageRecord, mergeActiveLanguageRecord, parseActiveLanguageRecord, reportableLanguages } from '../../common/positronUpdateUtils.js';

describe('buildReleaseNotesUrl', function () {
	it('builds the markdown URL from the update CDN base, channel, and version', () => {
		const result = buildReleaseNotesUrl('https://cdn.posit.co/positron', 'releases', '2026.08.0');
		expect(result).toBe('https://cdn.posit.co/positron/releases/release-notes/release-2026.08.0.md');
	});
});

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

	it('returns a language last used yesterday', () => {
		// The core design intent: report recent usage at cold start.
		const record: IActiveLanguageRecord = { lastUsed: { python: '2026-07-10' } };
		expect(reportableLanguages(record, now, maxAgeDays)).toEqual(['python']);
	});

	it('returns a language at exactly the max age boundary', () => {
		const record: IActiveLanguageRecord = { lastUsed: { r: '2026-07-04' } };
		expect(reportableLanguages(record, now, maxAgeDays)).toEqual(['r']);
	});

	it('returns every language used within the window, even on different days', () => {
		const record: IActiveLanguageRecord = { lastUsed: { r: '2026-07-06', python: '2026-07-10' } };
		expect(reportableLanguages(record, now, maxAgeDays)).toEqual(['python', 'r']);
	});

	it('omits only the languages older than the max age', () => {
		const record: IActiveLanguageRecord = { lastUsed: { r: '2026-07-03', python: '2026-07-10' } };
		expect(reportableLanguages(record, now, maxAgeDays)).toEqual(['python']);
	});

	it('returns empty when the record is undefined', () => {
		expect(reportableLanguages(undefined, now, maxAgeDays)).toEqual([]);
	});

	it('omits a language whose day is malformed', () => {
		const record: IActiveLanguageRecord = { lastUsed: { python: 'not-a-date' } };
		expect(reportableLanguages(record, now, maxAgeDays)).toEqual([]);
	});

	it('omits a language dated in the future (clock skew)', () => {
		const record: IActiveLanguageRecord = { lastUsed: { python: '2026-07-12' } };
		expect(reportableLanguages(record, now, maxAgeDays)).toEqual([]);
	});
});

// The read/write decision the update service delegates to. These exercise the
// same logic getReportableLanguages / updateActiveLanguages run, without the
// electron-main service's dependency graph and constructor side effects.
describe('active-language reporting (service logic)', function () {
	const maxAgeDays = 7;
	const now = Date.parse('2026-07-11T09:00:00Z');
	const nextDay = Date.parse('2026-07-12T09:00:00Z');

	describe('mergeActiveLanguageRecord', function () {
		it('stores today for each language in a non-empty set', () => {
			const stored = mergeActiveLanguageRecord(undefined, ['python', 'r'], now, maxAgeDays);
			expect(JSON.parse(stored!)).toEqual({ lastUsed: { python: '2026-07-11', r: '2026-07-11' } });
		});

		it('does not store an empty set, so a usage-free push cannot rewrite the record', () => {
			const afterR = mergeActiveLanguageRecord(undefined, ['r'], now, maxAgeDays);
			expect(mergeActiveLanguageRecord(afterR, [], nextDay, maxAgeDays)).toBeUndefined();
		});

		it('unions a new language into the same day (e.g. R and Python in separate windows)', () => {
			const afterR = mergeActiveLanguageRecord(undefined, ['r'], now, maxAgeDays);
			const afterPython = mergeActiveLanguageRecord(afterR, ['python'], now, maxAgeDays);
			expect(JSON.parse(afterPython!)).toEqual({ lastUsed: { python: '2026-07-11', r: '2026-07-11' } });
		});

		it('keeps a language from an earlier day when a different language is used today', () => {
			const yesterday = mergeActiveLanguageRecord(undefined, ['r'], now, maxAgeDays);
			const today = mergeActiveLanguageRecord(yesterday, ['python'], nextDay, maxAgeDays);
			expect(JSON.parse(today!)).toEqual({ lastUsed: { python: '2026-07-12', r: '2026-07-11' } });
		});

		it('drops languages older than the max age when it writes', () => {
			const old = JSON.stringify({ lastUsed: { r: '2026-07-01' } });
			const stored = mergeActiveLanguageRecord(old, ['python'], now, maxAgeDays);
			expect(JSON.parse(stored!)).toEqual({ lastUsed: { python: '2026-07-11' } });
		});

		it('converts a record in the earlier single-day format', () => {
			const legacy = JSON.stringify({ day: '2026-07-10', languages: ['r'] });
			const stored = mergeActiveLanguageRecord(legacy, ['python'], now, maxAgeDays);
			expect(JSON.parse(stored!)).toEqual({ lastUsed: { python: '2026-07-11', r: '2026-07-10' } });
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

		it('reads a record in the earlier single-day format', () => {
			const legacy = JSON.stringify({ day: '2026-07-10', languages: ['python', 'r'] });
			expect(parseActiveLanguageRecord(legacy)).toEqual({ lastUsed: { python: '2026-07-10', r: '2026-07-10' } });
		});

		it('ignores entries whose day is not a string', () => {
			expect(parseActiveLanguageRecord('{"lastUsed":{"python":"2026-07-10","r":5}}')).toEqual({ lastUsed: { python: '2026-07-10' } });
		});
	});

	it('reports languages used on different days within the window on the next launch', () => {
		// R on day 1, Python on day 2; a launch on day 3 reports both.
		const dayOne = mergeActiveLanguageRecord(undefined, ['r'], now, maxAgeDays);
		const dayTwo = mergeActiveLanguageRecord(dayOne, ['python'], nextDay, maxAgeDays);
		const dayThree = Date.parse('2026-07-13T09:00:00Z');
		expect(reportableLanguages(parseActiveLanguageRecord(dayTwo), dayThree, maxAgeDays)).toEqual(['python', 'r']);
	});
});
