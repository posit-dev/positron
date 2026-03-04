/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Evaluate Code', {
	tag: [tags.CRITICAL, tags.WEB]
}, () => {

	test.describe('R', {
		tag: [tags.ARK]
	}, () => {
		test.beforeEach(async function ({ app, r }) {
			await app.workbench.layouts.enterLayout('fullSizedPanel');
		});

		test('evaluate R expression returns JSON result', async ({ app, page }) => {
			// Open the command palette and run the evaluate code command,
			// keeping the quick input open since the command opens its own input
			await app.workbench.quickaccess.runCommand('workbench.action.evaluateCode', { keepOpen: true });

			// Wait for the input box to appear with our placeholder
			const inputBox = page.locator('.quick-input-widget .quick-input-box input');
			await expect(inputBox).toBeVisible();

			// Type the R expression and submit
			await inputBox.fill('list(a = 1, b = TRUE)');
			await page.keyboard.press('Enter');

			// Verify we get a notification with the result
			const notification = page.locator('.notification-toast');
			await expect(notification).toBeVisible({ timeout: 15000 });
		});
	});

	test.describe('Python', () => {
		test.beforeEach(async function ({ app, python }) {
			await app.workbench.layouts.enterLayout('fullSizedPanel');
		});

		test('evaluate Python expression returns JSON result', async ({ app, page }) => {
			// Open the command palette and run the evaluate code command,
			// keeping the quick input open since the command opens its own input
			await app.workbench.quickaccess.runCommand('workbench.action.evaluateCode', { keepOpen: true });

			// Wait for the input box to appear with our placeholder
			const inputBox = page.locator('.quick-input-widget .quick-input-box input');
			await expect(inputBox).toBeVisible();

			// Type the Python expression and submit
			await inputBox.fill('{"a": 1, "b": True}');
			await page.keyboard.press('Enter');

			// Verify we get a notification with the result
			const notification = page.locator('.notification-toast');
			await expect(notification).toBeVisible({ timeout: 15000 });
		});
	});
});
