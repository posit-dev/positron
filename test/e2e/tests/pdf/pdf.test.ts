/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { FrameLocator, Page } from '@playwright/test';

test.use({
	suiteId: __filename
});

function getPdfFrame(page: Page): FrameLocator {
	return page.frameLocator('.webview').frameLocator('#active-frame').frameLocator('#pdf-frame');
}

test.describe('PDF Viewer', {
	tag: [tags.WEB, tags.PDF]
}, () => {

	test('Can open and close PDF file', { tag: [tags.WIN] }, async function ({ openDataFile, page, app }) {
		await openDataFile('data-files/pdf/sample-local-pdf.pdf');

		const sampleText = getPdfFrame(page).locator('span', { hasText: 'Sample PDF' });
		await expect(sampleText).toBeVisible({ timeout: 30000 });

		// Regression: commands previously stopped working once a PDF was open
		await app.workbench.quickaccess.runCommand('workbench.action.closeActiveEditor');
		const filenames = await app.workbench.editor.getMonacoFilenames();
		expect(filenames.length).toBe(0);
	});

	// No @:win: the print path opens a native OS dialog that hangs the Windows worker
	test('Can print PDF file', async function ({ openDataFile, page, hotKeys }) {
		// pdf.js captures window.print at load; the real one opens a dialog that blocks the renderer
		await page.addInitScript(() => {
			if (location.pathname.endsWith('/pdfjs/web/viewer.html')) {
				window.print = () => { document.documentElement.dataset.printCalled = 'true'; };
			}
		});

		await openDataFile('data-files/pdf/sample-local-pdf.pdf');

		const pdfFrame = getPdfFrame(page);
		await expect(pdfFrame.locator('span', { hasText: 'Sample PDF' })).toBeVisible({ timeout: 30000 });

		// Secondary side bar hides the print button
		await hotKeys.closeSecondarySidebar();
		await pdfFrame.locator('#printButton').click();

		// pdf.js only calls print after preparing every page. The "Preparing document"
		// overlay closes as soon as print returns, so it can't be asserted reliably.
		await expect(pdfFrame.locator('html[data-print-called]')).toBeAttached();
	});

});
