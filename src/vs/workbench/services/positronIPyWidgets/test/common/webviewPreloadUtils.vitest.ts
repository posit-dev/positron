/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { isComplexHtml } from '../../common/webviewPreloadUtils.js';

describe('isComplexHtml', () => {
	ensureNoLeakedDisposables();

	// Active content is complex and must be isolated in a webview.
	const complexCases: [string, string][] = [
		['script', '<div><script>alert(1)</script></div>'],
		['iframe', '<iframe src="https://example.com"></iframe>'],
		['object', '<object data="file.swf"></object>'],
		['embed', '<embed src="file.pdf">'],
		['javascript: URL', '<a href="javascript:alert(1)">click</a>'],
		['event handler', '<img src="x" onerror="alert(1)">'],
	];
	for (const [label, html] of complexCases) {
		it(`detects ${label}`, () => {
			expect(isComplexHtml(html)).toBe(true);
		});
	}

	// Document structure and fragments are inert and render inline.
	const simpleCases: [string, string][] = [
		['doctype', '<!DOCTYPE html><html></html>'],
		['html', '<html><p>Hello</p></html>'],
		['body', '<body><p>Hello</p></body>'],
		['style block', '<html><head><style>p { color: red; }</style></head><body><p>x</p></body></html>'],
		['simple fragment', '<p>Hello world</p>'],
		['data attribute with "on" prefix', '<div data-onclick="value">test</div>'],
	];
	for (const [label, html] of simpleCases) {
		it(`treats ${label} as simple`, () => {
			expect(isComplexHtml(html)).toBe(false);
		});
	}
});
