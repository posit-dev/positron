/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { externalUriToString } from '../../common/positronUtilities.js';
import { URI } from '../../common/uri.js';

describe('externalUriToString', () => {
	test('preserves the query delimiters that URI.toString() escapes', () => {
		const uri = URI.parse('http://localhost:2718/?access_token=r5CYm4qmOctiDPq7TVrzeg');

		expect(externalUriToString(uri)).toBe('http://localhost:2718/?access_token=r5CYm4qmOctiDPq7TVrzeg');
	});

	test('preserves delimiters when a parameter is appended to the query', () => {
		// Mirrors PreviewUrl.navigateToUri, which concatenates a cache-busting nonce
		// onto the existing query before handing the URI to the webview.
		const uri = URI.parse('http://localhost:2718/?access_token=abc')
			.with({ query: 'access_token=abc&_positronRender=1' });

		expect(externalUriToString(uri)).toBe('http://localhost:2718/?access_token=abc&_positronRender=1');
	});

	test('encodes characters that would break out of an HTML attribute', () => {
		const uri = URI.parse('http://localhost:2718/?q=a"b');

		expect(externalUriToString(uri)).toBe('http://localhost:2718/?q=a%22b');
	});

	test('leaves a file URI intact', () => {
		const uri = URI.file('/Users/me/notebook.py');

		expect(externalUriToString(uri)).toBe('file:///Users/me/notebook.py');
	});
});
