/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />


import { ensureNoLeakedDisposables } from '../../../../test/vitest/vitestUtils.js';
import { buildUpdateUrl } from '../../common/positronUpdateUtils.js';

describe('buildUpdateUrl', function () {
	ensureNoLeakedDisposables();

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
			expect(result.indexOf('python=1') < result.indexOf('uuid=')).toBeTruthy();
		});
	});
});
