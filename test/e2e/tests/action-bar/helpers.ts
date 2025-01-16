/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect } from '@playwright/test';

export async function verifySplitEditor(page, tabName: string) {
	await test.step(`Verify "split editor" opens another tab`, async () => {

		// Split editor right
		await page.getByLabel('Split Editor Right', { exact: true }).click();
		await expect(page.getByRole('tab', { name: tabName })).toHaveCount(2);

		// Close one tab
		await page.getByRole('tab', { name: tabName }).getByLabel('Close').first().click();

		// Split editor down
		await page.keyboard.down('Alt');
		await page.getByLabel('Split Editor Down').click();
		await page.keyboard.up('Alt');
		await expect(page.getByRole('tab', { name: tabName })).toHaveCount(2);

	});
}

export async function verifyOpenInNewWindow(page, expectedText: string) {
	await test.step(`Verify "open new window" contains: ${expectedText}`, async () => {
		const [newPage] = await Promise.all([
			page.context().waitForEvent('page'),
			page.getByLabel('Move into new window').first().click(),
		]);
		await newPage.waitForLoadState();
		await expect(newPage.getByText(expectedText)).toBeVisible();
	});
}
