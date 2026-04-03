/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('PDF Viewer', {
	tag: [tags.WEB, tags.WIN, tags.PDF]
}, () => {

	test('Can open and view PDF file', async function ({ openDataFile, page }) {
		// Open the PDF file
		await openDataFile('data-files/pdf/sample-local-pdf.pdf');

		// Navigate through the nested iframe structure
		// Outer iframe with class 'webview'
		const outerFrame = page.frameLocator('.webview');
		// Inner iframe with id 'active-frame'
		const innerFrame = outerFrame.frameLocator('#active-frame');
		// PDF iframe with id 'pdf-frame'
		const pdfFrame = innerFrame.frameLocator('#pdf-frame');

		// Find the text "Sample PDF" inside a span in the PDF
		const sampleText = pdfFrame.locator('span', { hasText: 'Sample PDF' });
		await expect(sampleText).toBeVisible({ timeout: 30000 });
	});

});
