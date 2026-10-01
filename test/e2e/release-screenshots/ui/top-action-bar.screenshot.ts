/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test } from '../../tests/_test.setup';
import { capturePanelHires } from '../_helpers/screenshot-utils';
import { clearAnnotations } from '../_helpers/annotate-utils';
import { hideToasts, setScreenshotWindowSize, waitForStableUI } from '../_helpers/layout-utils';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

// Annotations are appended to the page <body> and persist across tests in the
// same suite. Clear them so the next test's screenshot starts unannotated.
test.afterEach(async ({ page }) => {
	await clearAnnotations(page);
});

test.describe('Release Screenshots - Top Action Bar', () => {
	/**
	 * Img Path: https://positron.posit.co/images/action-bar-information.png
	 */
	test('Release Screenshot - action-bar-information.png', async ({ app, page }) => {
		const folderMenu = page.locator('.top-action-bar-custom-folder-menu');
		await expect(folderMenu).toBeVisible();

		// Override the displayed folder name so the docs screenshot reads "my-project".
		await page.evaluate(() => {
			const el = document.querySelector('#top-action-bar-current-working-folder');
			if (el) { el.textContent = 'my-project'; }
		});

		// capture screenshot (at 2x so the docs have a crisp image to scale)
		await hideToasts(app);
		await waitForStableUI(page);
		await capturePanelHires(page, folderMenu, 'action-bar-information.png', 2);
	});
});
