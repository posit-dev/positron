/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isComplexHtml } from '../../common/webviewPreloadUtils.js';

suite('isComplexHtml', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// Each entry exercises a distinct detection branch in isComplexHtml().
	const complexCases: [string, string][] = [
		['script', '<div><script>alert(1)</script></div>'],
		['iframe', '<iframe src="https://example.com"></iframe>'],
		['object', '<object data="file.swf"></object>'],
		['embed', '<embed src="file.pdf">'],
		['body', '<body><p>Hello</p></body>'],
		['html', '<html><p>Hello</p></html>'],
		['doctype', '<!DOCTYPE html><html></html>'],
		['javascript: URL', '<a href="javascript:alert(1)">click</a>'],
		['event handler', '<img src="x" onerror="alert(1)">'],
	];
	for (const [label, html] of complexCases) {
		test(`detects ${label}`, () => {
			assert.strictEqual(isComplexHtml(html), true);
		});
	}

	test('data attributes containing "on" prefix are not complex', () => {
		assert.strictEqual(isComplexHtml('<div data-onclick="value">test</div>'), false);
	});

	test('simple HTML is not complex', () => {
		assert.strictEqual(isComplexHtml('<p>Hello world</p>'), false);
	});
});
