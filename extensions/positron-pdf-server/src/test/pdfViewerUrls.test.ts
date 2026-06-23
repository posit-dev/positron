/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { buildPdfViewerUrls } from '../pdfViewerUrls';

suite('buildPdfViewerUrls', () => {
	test('normalizes a base URL without a trailing slash', () => {
		assert.deepStrictEqual(buildPdfViewerUrls('http://localhost:8080', 'abc', 1), {
			baseUrl: 'http://localhost:8080/',
			pdfUrl: 'http://localhost:8080/pdf/abc',
			viewerUrl: `http://localhost:8080/viewer?file=${encodeURIComponent('http://localhost:8080/pdf/abc')}&theme=1`,
		});
	});

	test('does not add a second slash when the base URL already ends with one', () => {
		assert.deepStrictEqual(buildPdfViewerUrls('https://host/proxy/8080/', 'abc', 2), {
			baseUrl: 'https://host/proxy/8080/',
			pdfUrl: 'https://host/proxy/8080/pdf/abc',
			viewerUrl: `https://host/proxy/8080/viewer?file=${encodeURIComponent('https://host/proxy/8080/pdf/abc')}&theme=2`,
		});
	});
});
