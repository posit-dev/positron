/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { buildUpdateUrl } from '../../common/positronUpdateUtils.js';

suite('buildUpdateUrl', function () {
	ensureNoDisposablesAreLeakedInTestSuite();

	const baseUrl = 'https://updates.example.com/releases/darwin/arm64/releases.json';

	suite('with no optional parameters', function () {
		test('returns base URL unchanged when no languages and no anonymous ID', () => {
			const result = buildUpdateUrl(baseUrl, [], false, undefined);
			assert.strictEqual(result, baseUrl);
		});

		test('returns base URL unchanged when languages disabled even with languages present', () => {
			const result = buildUpdateUrl(baseUrl, ['python', 'r'], false, undefined);
			assert.strictEqual(result, baseUrl);
		});

		test('returns base URL unchanged when languages enabled but empty', () => {
			const result = buildUpdateUrl(baseUrl, [], true, undefined);
			assert.strictEqual(result, baseUrl);
		});
	});

	suite('with language parameters', function () {
		test('includes single language parameter', () => {
			const result = buildUpdateUrl(baseUrl, ['python'], true, undefined);
			assert.strictEqual(result, `${baseUrl}?python=1`);
		});

		test('includes multiple language parameters', () => {
			const result = buildUpdateUrl(baseUrl, ['python', 'r'], true, undefined);
			assert.strictEqual(result, `${baseUrl}?python=1&r=1`);
		});
	});

	suite('with anonymous ID parameter', function () {
		test('includes uuid parameter when anonymous ID provided', () => {
			const anonymousId = '12345678-1234-1234-1234-123456789012';
			const result = buildUpdateUrl(baseUrl, [], false, anonymousId);
			assert.strictEqual(result, `${baseUrl}?uuid=${anonymousId}`);
		});

		test('does not include uuid parameter when anonymous ID is undefined', () => {
			const result = buildUpdateUrl(baseUrl, [], false, undefined);
			assert.strictEqual(result, baseUrl);
		});
	});

	suite('with both languages and anonymous ID', function () {
		test('includes both language and uuid parameters', () => {
			const anonymousId = '12345678-1234-1234-1234-123456789012';
			const result = buildUpdateUrl(baseUrl, ['python', 'r'], true, anonymousId);
			assert.strictEqual(result, `${baseUrl}?python=1&r=1&uuid=${anonymousId}`);
		});

		test('languages come before uuid in query string', () => {
			const anonymousId = '12345678-1234-1234-1234-123456789012';
			const result = buildUpdateUrl(baseUrl, ['python'], true, anonymousId);
			assert.ok(result.indexOf('python=1') < result.indexOf('uuid='), 'language should come before uuid');
		});
	});
});
