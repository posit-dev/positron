/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from './baseTestPositron';

test.only('should do basic stuff', async ({ workbox }) => {
	await expect(workbox.getByText('There is no interpreter')).toBeVisible({ timeout: 15000 });

	workbox.getByRole('tab', { name: 'Explorer (⇧⌘E)' }).locator('a').click();
	await expect(workbox.getByLabel('Start Debugging (F5), use (⌥')).not.toBeVisible();
	workbox.getByRole('tab', { name: 'Run and Debug (⇧⌘D)' }).locator('a').click();
	await expect(workbox.getByLabel('Start Debugging (F5), use (⌥')).toBeVisible();
	await workbox.waitForTimeout(2000);
});
