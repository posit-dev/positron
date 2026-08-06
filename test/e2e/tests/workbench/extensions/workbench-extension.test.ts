/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Workbench Extension', {
	tag: [tags.WORKBENCH, tags.EXTENSIONS],
}, () => {

	test('Verify Posit Workbench status bar item', async function ({ app }) {

		const workbenchStatusItem = app.code.driver.currentPage.locator('a.statusbar-item-label[aria-label*="Posit Workbench"]');

		await expect(workbenchStatusItem).toBeVisible();

		// Wait for new page to open when clicking the status bar item
		const pagePromise = app.code.driver.currentPage.context().waitForEvent('page');
		await workbenchStatusItem.click();
		const workbenchPage = await pagePromise;

		// Wait for the page to load
		await workbenchPage.waitForLoadState('domcontentloaded');

		// Verify we're on the Workbench landing page
		await expect(workbenchPage.getByRole('link', { name: 'Workbench projects' })).toBeVisible();

		// Click the session link to return to the session. The Project cell is plain text, so the
		// only link in the row is the session name -- and that name varies ("Positron Pro Session"
		// when launched from the row, the project name when created via the New Session dialog).
		// Anchor on the project's row and take whatever link it holds instead of naming it.
		await workbenchPage
			.getByRole('table', { name: 'Projects table' })
			.getByRole('row', { name: 'test-files' })
			.getByRole('link')
			.first()
			.click();

		// Wait for navigation back to the session
		await workbenchPage.waitForLoadState('domcontentloaded');

		// Close the workbench page to return focus to Positron
		await workbenchPage.close();

		// Verify we're back in Positron
		await expect(workbenchStatusItem).toBeVisible();

	});
});
