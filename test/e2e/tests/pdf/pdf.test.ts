/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { FrameLocator, Page } from '@playwright/test';

test.use({
	suiteId: __filename
});

/**
 * Navigate through the nested iframe structure to access the PDF viewer frame.
 * @param page - The Playwright page object
 * @returns The PDF frame locator
 */
function getPdfFrame(page: Page): FrameLocator {
	// Outer iframe with class 'webview'
	const outerFrame = page.frameLocator('.webview');
	// Inner iframe with id 'active-frame'
	const innerFrame = outerFrame.frameLocator('#active-frame');
	// PDF iframe with id 'pdf-frame'
	return innerFrame.frameLocator('#pdf-frame');
}

test.describe('PDF Viewer', {
	tag: [tags.WEB, tags.WIN, tags.PDF]
}, () => {

	test('Can open and close PDF file', async function ({ openDataFile, page, app }) {
		// Open the PDF file
		await openDataFile('data-files/pdf/sample-local-pdf.pdf');

		// Navigate to the PDF frame
		const pdfFrame = getPdfFrame(page);

		// Find the text "Sample PDF" inside a span in the PDF
		const sampleText = pdfFrame.locator('span', { hasText: 'Sample PDF' });
		await expect(sampleText).toBeVisible({ timeout: 30000 });

		// we previously had an issue where commands didn't work after opening a PDF, so verify that the command palette works
		await app.workbench.quickaccess.runCommand('workbench.action.closeActiveEditor');
		// Verify the tab closed
		const filenames = await app.workbench.editor.getMonacoFilenames();
		expect(filenames.length).toBe(0);
	});

	test('Can print PDF file', async function ({ openDataFile, page, hotKeys }) {
		// Open the PDF file
		await openDataFile('data-files/pdf/sample-local-pdf.pdf');

		// Navigate to the PDF frame
		const pdfFrame = getPdfFrame(page);

		// Wait for PDF to load
		const sampleText = pdfFrame.locator('span', { hasText: 'Sample PDF' });
		await expect(sampleText).toBeVisible({ timeout: 30000 });

		// Hide the secondary side bar to make print button visible
		await hotKeys.closeSecondarySidebar();

		// Click the print button in the PDF viewer
		const printButton = pdfFrame.locator('#printButton');
		await printButton.click();

		// Verify the print preparation dialog appears
		const printDialog = pdfFrame.getByText('Preparing document for printing');
		await expect(printDialog).toBeVisible({ timeout: 10000 });

		// Test ends here - Playwright will clean up the Electron process and any native dialogs
	});

	// do not add another test here as it would be blocked by a native dialog (print preview) that cannot be interacted with using Playwright, which would cause the test suite to hang

});
