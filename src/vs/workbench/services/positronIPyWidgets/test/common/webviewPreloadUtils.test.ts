/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isComplexHtml } from '../../common/webviewPreloadUtils.js';

suite('isComplexHtml', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// Positive cases: these should all be detected as complex
	test('detects script tags', () => {
		assert.strictEqual(isComplexHtml('<div><script>alert(1)</script></div>'), true);
	});

	test('detects iframe tags', () => {
		assert.strictEqual(isComplexHtml('<iframe src="https://example.com"></iframe>'), true);
	});

	test('detects object tags', () => {
		assert.strictEqual(isComplexHtml('<object data="file.swf"></object>'), true);
	});

	test('detects embed tags', () => {
		assert.strictEqual(isComplexHtml('<embed src="file.pdf">'), true);
	});

	test('detects full HTML documents with body', () => {
		assert.strictEqual(isComplexHtml('<html><body><p>Hello</p></body></html>'), true);
	});

	test('detects doctype declarations', () => {
		assert.strictEqual(isComplexHtml('<!DOCTYPE html><html></html>'), true);
	});

	test('detects javascript: URLs', () => {
		assert.strictEqual(isComplexHtml('<a href="javascript:alert(1)">click</a>'), true);
	});

	test('detects inline event handlers', () => {
		assert.strictEqual(isComplexHtml('<img src="x" onerror="alert(1)">'), true);
	});

	test('detects onclick handler', () => {
		assert.strictEqual(isComplexHtml('<button onclick="doSomething()">Click</button>'), true);
	});

	test('is case-insensitive for tags', () => {
		assert.strictEqual(isComplexHtml('<SCRIPT>alert(1)</SCRIPT>'), true);
		assert.strictEqual(isComplexHtml('<IFrame src="x"></IFrame>'), true);
	});

	// Negative cases: these should NOT be detected as complex
	test('simple HTML paragraph is not complex', () => {
		assert.strictEqual(isComplexHtml('<p>Hello world</p>'), false);
	});

	test('HTML with inline styles is not complex', () => {
		assert.strictEqual(isComplexHtml('<div style="color: red">styled</div>'), false);
	});

	test('data attributes containing "on" prefix are not complex', () => {
		assert.strictEqual(isComplexHtml('<div data-onclick="value">test</div>'), false);
	});

	test('HTML table is not complex', () => {
		assert.strictEqual(isComplexHtml('<table><tr><td>cell</td></tr></table>'), false);
	});

	test('empty string is not complex', () => {
		assert.strictEqual(isComplexHtml(''), false);
	});
});
