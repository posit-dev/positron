/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isComplexHtml } from '../../common/webviewPreloadUtils.js';

suite('isComplexHtml', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('detects script tags', () => {
		assert.strictEqual(isComplexHtml('<div><script>alert(1)</script></div>'), true);
	});

	test('detects iframe tags', () => {
		assert.strictEqual(isComplexHtml('<iframe src="https://example.com"></iframe>'), true);
	});

	test('detects full HTML documents', () => {
		assert.strictEqual(isComplexHtml('<html><body><p>Hello</p></body></html>'), true);
	});

	test('detects javascript: URLs', () => {
		assert.strictEqual(isComplexHtml('<a href="javascript:alert(1)">click</a>'), true);
	});

	test('detects inline event handlers', () => {
		assert.strictEqual(isComplexHtml('<img src="x" onerror="alert(1)">'), true);
	});

	test('data attributes containing "on" prefix are not complex', () => {
		assert.strictEqual(isComplexHtml('<div data-onclick="value">test</div>'), false);
	});

	test('simple HTML is not complex', () => {
		assert.strictEqual(isComplexHtml('<p>Hello world</p>'), false);
	});
});
