/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test } from './test.setup';



test('should do basic stuff', async ({ page }) => {
	await expect(page.getByText('There is no interpreter')).toBeVisible({ timeout: 15000 });

	page.getByRole('tab', { name: 'Explorer (⇧⌘E)' }).locator('a').click();
	await expect(page.getByLabel('Start Debugging (F5), use (⌥')).not.toBeVisible();
	page.getByRole('tab', { name: 'Run and Debug (⇧⌘D)' }).locator('a').click();
	await expect(page.getByLabel('Start Debugging (F5), use (⌥')).toBeVisible();
	await page.waitForTimeout(2000);

});
