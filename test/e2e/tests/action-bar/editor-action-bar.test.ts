/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { Application } from '../../infra';
import { Page } from '@playwright/test';
import path = require('path');


test.use({
	suiteId: __filename
});

test.describe('Editor Action Bar', {
	tag: [tags.WEB, tags.WIN, tags.EDITOR_ACTION_BAR, tags.EDITOR]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['editor.actionBar.enabled', 'true']], false);
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
	});

	test('R Markdown Document [C1080703]', {
		tag: [tags.R_MARKDOWN]
	}, async function ({ app, page }) {
		await openFile(app, 'workspaces/basic-rmd-file/basicRmd.rmd');
		await verifyPreviewRendersHtml(app, 'Getting startedAnchor');
		await verifySplitEditor(page, 'basicRmd.rmd');
		await verifyOpenInNewWindow(page, 'This post examines the features');
	});

	test('Quarto Document [C1080700]', {
		tag: [tags.QUARTO]
	}, async function ({ app, page }) {
		await openFile(app, 'workspaces/quarto_basic/quarto_basic.qmd');
		await verifyPreviewRendersHtml(app, 'Diamond sizes');
		await verifyOpenChanges(page);
		await verifySplitEditor(page, 'quarto_basic.qmd');
		await verifyOpenInNewWindow(page, 'Diamond sizes');
	});

	test('HTML Document [C1080701]', { tag: [tags.HTML] }, async function ({ app, page }) {
		await openFile(app, 'workspaces/dash-py-example/data/OilandGasMetadata.html');
		await verifyOpenViewerRendersHtml(app);
		await verifySplitEditor(page, 'OilandGasMetadata.html');
		await verifyOpenInNewWindow(page, '<title> Oil &amp; Gas Wells - Metadata</title>');
	});

	test('Jupyter Notebook [C1080702]', {
		tag: [tags.NOTEBOOKS],
		annotation: [{ type: 'info', description: 'electron test unable to interact with dropdown native menu' }],
	}, async function ({ app, page }) {
		await openNotebook(app, 'workspaces/large_r_notebook/spotify.ipynb');

		if (app.web) {
			await verifyToggleLineNumbers(page);
			await verifyToggleBreadcrumb(page);
		}

		await verifySplitEditor(page, 'spotify.ipynb');
	});
});


// Helper functions
async function openFile(app, filePath: string) {
	const fileName = path.basename(filePath);
	await test.step(`open file: ${fileName}`, async () => {
		await app.workbench.quickaccess.openFile(path.join(app.workspacePathOrFolder, filePath));
	});
}

async function openNotebook(app: Application, filePath: string) {
	await test.step('open jupyter notebook', async () => {
		await app.workbench.quickaccess.openDataFile(
			path.join(app.workspacePathOrFolder, filePath)
		);
	});
}

async function verifySplitEditor(page, tabName: string) {
	await test.step(`verify "split editor" opens another tab`, async () => {
		// Split editor right
		// Sometimes in CI the click doesn't register, wrapping these actions to reduce flake
		await expect(async () => {
			await page.getByLabel('Split Editor Right', { exact: true }).click();
			await expect(page.getByRole('tab', { name: tabName })).toHaveCount(2);
		}).toPass({ timeout: 10000 });

		// Close one tab
		await page.getByRole('tab', { name: tabName }).getByLabel('Close').first().click();

		// Split editor down
		// Sometimes in CI the click doesn't register, wrapping these actions to reduce flake
		await expect(async () => {
			await page.keyboard.down('Alt');
			await page.getByLabel('Split Editor Down').click();
			await page.keyboard.up('Alt');
			await expect(page.getByRole('tab', { name: tabName })).toHaveCount(2);
		}).toPass({ timeout: 10000 });

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

async function clickCustomizeNotebookMenuItem(page, menuItem: string) {
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

async function verifyLineNumbersVisibility(page, isVisible: boolean) {
	for (const lineNum of [1, 2, 3, 4, 5]) {
		const lineNumbers = expect(page.locator('.line-numbers').getByText(lineNum.toString(), { exact: true }));
		isVisible ? await lineNumbers.toBeVisible() : await lineNumbers.not.toBeVisible();
	}
}

async function verifyOpenChanges(page: Page) {
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

async function bindPlatformHotkey(page: Page, key: string) {
	await page.keyboard.press(process.platform === 'darwin' ? `Meta+${key}` : `Control+${key}`);
}

async function verifyOpenViewerRendersHtml(app: Application) {
	await test.step('verify "open in viewer" renders html', async () => {
		await app.code.driver.page.getByLabel('Open in Viewer').click();
		const viewerFrame = app.code.driver.page.locator('iframe.webview').contentFrame().locator('#active-frame').contentFrame();
		const cellLocator = app.web
			? viewerFrame.frameLocator('iframe').getByRole('cell', { name: 'Oil, Gas, and Other Regulated' })
			: viewerFrame.getByRole('cell', { name: 'Oil, Gas, and Other Regulated' });

		await expect(cellLocator).toBeVisible({ timeout: 30000 });
	});
}

async function verifyPreviewRendersHtml(app: Application, heading: string) {
	await test.step('verify "preview" renders html', async () => {
		await app.code.driver.page.getByLabel('Preview', { exact: true }).click();
		const viewerFrame = app.workbench.viewer.getViewerFrame().frameLocator('iframe');
		await expect(viewerFrame.getByRole('heading', { name: heading })).toBeVisible({ timeout: 30000 });
	});
}

async function verifyToggleLineNumbers(page: Page) {
	await test.step('verify "customize notebook > toggle line numbers" (web only)', async () => {
		await verifyLineNumbersVisibility(page, false);
		await clickCustomizeNotebookMenuItem(page, 'Toggle Notebook Line Numbers');
		await verifyLineNumbersVisibility(page, true);
	});
}

async function verifyToggleBreadcrumb(page: Page) {
	await test.step('verify "customize notebook > toggle breadcrumbs" (web only)', async () => {
		const breadcrumbs = page.locator('.monaco-breadcrumbs');

		await expect(breadcrumbs).toBeVisible();
		await clickCustomizeNotebookMenuItem(page, 'Toggle Breadcrumbs');
		await expect(breadcrumbs).not.toBeVisible();
	});
}
