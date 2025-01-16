/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { Application } from '../../infra';
import { Page } from '@playwright/test';

test.use({
	suiteId: __filename
});

test.describe('Action Bar: Data Explorer', {
	tag: [tags.WEB, tags.WIN, tags.ACTION_BAR, tags.EDITOR]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['editor.actionBar.enabled', 'true']], false);
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
	});

	test('Python Pandas [...]', {
		tag: [tags.R_MARKDOWN]
	}, async function ({ app, page, openFile, python }) {

		// load data in data explorer
		await openFile('workspaces/polars-dataframe-py/polars_basic.py');
		await app.workbench.quickaccess.runCommand('python.execInConsole');
		await app.workbench.variables.doubleClickVariableRow('df');
		await page.getByRole('tab', { name: 'polars_basic.py' }).getByLabel('Close').click();
		await expect(page.getByText('Data: df', { exact: true })).toBeVisible();

		await verifySummaryPosition(app, 'Left');
		await verifySummaryPosition(app, 'Right');
		await verifySplitEditor(page, 'Data: df');
		// await verifyOpenInNewWindow(page, 'Data: df — qa-example-content');
	});

	test('R [...]', {
		tag: [tags.R_MARKDOWN]
	}, async function ({ app, page, openFile, r }) {

		// load data in data explorer
		await app.workbench.console.executeCode('R', rScript, '>');
		await app.workbench.variables.doubleClickVariableRow('Data_Frame');
		await expect(app.code.driver.page.getByText('Data: Data_Frame', { exact: true })).toBeVisible();

		await verifySummaryPosition(app, 'Left');
		await verifySummaryPosition(app, 'Right');
		await verifySplitEditor(page, 'Data: df');
	});
});


async function verifySplitEditor(page: Page, tabName: string) {
	await test.step(`verify "split editor" opens another tab`, async () => {
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

async function verifyOpenInNewWindow(page, expectedText: string) {
	await test.step(`verify "open new window" contains: ${expectedText}`, async () => {
		const [newPage] = await Promise.all([
			page.context().waitForEvent('page'),
			page.getByLabel('Move into new window').first().click(),
		]);
		await newPage.waitForLoadState();
		await expect(newPage.getByText(expectedText)).toBeVisible();
	});
}

async function verifySummaryPosition(app: Application, position: 'Left' | 'Right') {
	const page = app.code.driver.page;

	await test.step(`verify summary position: ${position}`, async () => {
		// Toggle the summary position
		//   * Web: Via the action bar
		//   * Desktop: Via the command palette
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

// snippet from https://www.w3schools.com/r/r_data_frames.asp
const rScript = `Data_Frame <- data.frame (
	Training = c("Strength", "Stamina", "Other"),
	Pulse = c(100, NA, 120),
	Duration = c(60, 30, 45),
	Note = c(NA, NA, "Note")
)`;
