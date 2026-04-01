/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isCopyImageMenuArg, toBase64DataUrl } from '../../browser/copyImageUtils.js';

suite('copyImageUtils', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('toBase64DataUrl', () => {
		test('returns already-base64 data URLs unchanged', () => {
			const url = 'data:image/png;base64,iVBORw0KGgo=';
			assert.strictEqual(toBase64DataUrl(url), url);
		});

		test('returns data URLs with no comma unchanged', () => {
			const url = 'data:image/png';
			assert.strictEqual(toBase64DataUrl(url), url);
		});

		test('converts URL-encoded SVG data URL to base64', () => {
			const svg = '<svg><circle r="10"/></svg>';
			const input = `data:image/svg+xml,${encodeURIComponent(svg)}`;
			const result = toBase64DataUrl(input);
			assert.ok(result.startsWith('data:image/svg+xml;base64,'));
			assert.ok(!result.includes('%3C'));
		});

		test('handles raw SVG payload with literal percent signs', () => {
			// Literal '%' that is not valid URL-encoding should not throw
			const input = 'data:image/svg+xml,<text>100% done</text>';
			const result = toBase64DataUrl(input);
			assert.ok(result.startsWith('data:image/svg+xml;base64,'));
		});

		test('handles SVG with Unicode characters', () => {
			const svg = '<svg><text>\u00e9\u00e0\u00fc</text></svg>';
			const input = `data:image/svg+xml,${encodeURIComponent(svg)}`;
			const result = toBase64DataUrl(input);
			assert.ok(result.startsWith('data:image/svg+xml;base64,'));
		});
	});

	suite('isCopyImageMenuArg', () => {
		test('returns true for valid arg', () => {
			assert.ok(isCopyImageMenuArg({ imageDataUrl: 'data:image/png;base64,abc' }));
		});

		test('returns false for null', () => {
			assert.ok(!isCopyImageMenuArg(null));
		});

		test('returns false for missing imageDataUrl', () => {
			assert.ok(!isCopyImageMenuArg({ other: 'value' }));
		});

		test('returns false for non-string imageDataUrl', () => {
			assert.ok(!isCopyImageMenuArg({ imageDataUrl: 123 }));
		});
	});
});
