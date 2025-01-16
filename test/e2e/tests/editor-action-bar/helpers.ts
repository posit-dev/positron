/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Page } from '@playwright/test';
import { Application } from '../../infra';

// --- SHARED HELPERS ---

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


// --- editor-action-bar-data-explorer.test.ts HELPERS ---

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

// --- editor-action-bar-documents.test.ts HELPERS ---


export async function clickCustomizeNotebookMenuItem(page, menuItem: string) {
	const role = menuItem.includes('Line Numbers') ? 'menuitemcheckbox' : 'menuitem';
	const dropdownButton = page.getByLabel('Customize Notebook...');
	await dropdownButton.evaluate((button) => {
		(button as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
	});

	const toggleMenuItem = page.getByRole(role, { name: menuItem });
	await toggleMenuItem.hover();
	await page.waitForTimeout(500);
	await toggleMenuItem.click();
}

export async function verifyLineNumbersVisibility(page, isVisible: boolean) {
	for (const lineNum of [1, 2, 3, 4, 5]) {
		const lineNumbers = expect(page.locator('.line-numbers').getByText(lineNum.toString(), { exact: true }));
		isVisible ? await lineNumbers.toBeVisible() : await lineNumbers.not.toBeVisible();
	}
}

export async function verifyOpenChanges(page: Page) {
	await test.step('verify "open changes" shows diff', async () => {

		// make change & save
		await page.getByText('date', { exact: true }).click();
		await page.keyboard.press('X');
		await bindPlatformHotkey(page, 'S');

		// click open changes & verify
		await page.getByLabel('Open Changes').click();
		await expect(page.getByLabel('Revert Block')).toBeVisible();
		await expect(page.getByLabel('Stage Block')).toBeVisible();
		await page.getByRole('tab', { name: 'quarto_basic.qmd (Working' }).getByLabel('Close').click();

		// undo changes & save
		await bindPlatformHotkey(page, 'Z');
		await bindPlatformHotkey(page, 'S');
	});
}

export async function bindPlatformHotkey(page: Page, key: string) {
	await page.keyboard.press(process.platform === 'darwin' ? `Meta+${key}` : `Control+${key}`);
}

export async function verifyOpenViewerRendersHtml(app: Application) {
	await test.step('verify "open in viewer" renders html', async () => {
		await app.code.driver.page.getByLabel('Open in Viewer').click();
		const viewerFrame = app.code.driver.page.locator('iframe.webview').contentFrame().locator('#active-frame').contentFrame();
		const cellLocator = app.web
			? viewerFrame.frameLocator('iframe').getByRole('cell', { name: 'Oil, Gas, and Other Regulated' })
			: viewerFrame.getByRole('cell', { name: 'Oil, Gas, and Other Regulated' });

		await expect(cellLocator).toBeVisible({ timeout: 30000 });
	});
}

export async function verifyPreviewRendersHtml(app: Application, heading: string) {
	await test.step('verify "preview" renders html', async () => {
		await app.code.driver.page.getByLabel('Preview', { exact: true }).click();
		const viewerFrame = app.workbench.viewer.getViewerFrame().frameLocator('iframe');
		await expect(viewerFrame.getByRole('heading', { name: heading })).toBeVisible({ timeout: 30000 });
	});
}

export async function verifyToggleLineNumbers(page: Page) {
	await test.step('verify "customize notebook > toggle line numbers" (web only)', async () => {
		await verifyLineNumbersVisibility(page, false);
		await clickCustomizeNotebookMenuItem(page, 'Toggle Notebook Line Numbers');
		await verifyLineNumbersVisibility(page, true);
	});
}

export async function verifyToggleBreadcrumb(page: Page) {
	await test.step('verify "customize notebook > toggle breadcrumbs" (web only)', async () => {
		const breadcrumbs = page.locator('.monaco-breadcrumbs');

		await expect(breadcrumbs).toBeVisible();
		await clickCustomizeNotebookMenuItem(page, 'Toggle Breadcrumbs');
		await expect(breadcrumbs).not.toBeVisible();
	});
}
