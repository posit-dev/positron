/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { isComplexHtml } from '../../common/webviewPreloadUtils.js';

describe('isComplexHtml', () => {
	ensureNoLeakedDisposables();

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
		it(`detects ${label}`, () => {
			expect(isComplexHtml(html)).toBe(true);
		});
	}

	it('data attributes containing "on" prefix are not complex', () => {
		expect(isComplexHtml('<div data-onclick="value">test</div>')).toBe(false);
	});

	it('simple HTML is not complex', () => {
		expect(isComplexHtml('<p>Hello world</p>')).toBe(false);
	});
});
