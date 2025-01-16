/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect } from '@playwright/test';
import { Application } from '../../infra';

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

export async function verifyOpenInNewWindow(app: Application, expectedText: string) {
	if (!app.web) {
		await test.step(`Verify "open new window" contains: ${expectedText}`, async () => {
			const [newPage] = await Promise.all([
				app.code.driver.page.context().waitForEvent('page'),
				app.code.driver.page.getByLabel('Move into new window').first().click(),
			]);
			await newPage.waitForLoadState();
			await expect(newPage.getByText(expectedText)).toBeVisible();
		});
	}
}

export async function verifySummaryPosition(app: Application, position: 'Left' | 'Right') {
	const page = app.code.driver.page;

	await test.step(`Verify summary position: ${position}`, async () => {
		// Toggle the summary position
		if (app.web) {
			await page.getByLabel('More actions', { exact: true }).click();
			await page.getByRole('menuitemcheckbox', { name: `Summary on ${position}` }).hover();
			await page.keyboard.press('Enter');
		}
		else {
			await app.workbench.quickaccess.runCommand(`workbench.action.positronDataExplorer.summaryOn${position}`);
		}

		// Locator for the summary element
		const summaryLocator = page.locator('div.column-summary').first();
		const tableLocator = page.locator('div.data-grid-column-headers');

		// Ensure both the summary and table elements are visible
		await Promise.all([
			expect(summaryLocator).toBeVisible(),
			expect(tableLocator).toBeVisible(),
		]);

		// Get the bounding boxes for both elements
		const summaryBox = await summaryLocator.boundingBox();
		const tableBox = await tableLocator.boundingBox();

		// Validate bounding boxes are available
		if (!summaryBox || !tableBox) {
			throw new Error('Bounding boxes could not be retrieved for summary or table.');
		}

		// Validate positions based on the expected position
		position === 'Left'
			? expect(summaryBox.x).toBeLessThan(tableBox.x)
			: expect(summaryBox.x).toBeGreaterThan(tableBox.x);
	});
}
