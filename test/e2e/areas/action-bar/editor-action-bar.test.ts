/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import path = require('path');

test.use({
	suiteId: __filename
});

test.describe('Editor Action Bar', {
	tag: [tags.WEB, tags.ACTION_BAR, tags.EDITOR]
}, () => {
	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['editor.actionBar.enabled', 'true']], false);
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.positronQuickaccess.runCommand('workbench.action.closeAllEditors');
	});

	test('R Markdown Document [C1080703]', {
		tag: [tags.R_MARKDOWN]
	}, async function ({ app, page }) {
		await openFile(app, 'workspaces/basic-rmd-file/basicRmd.rmd');

		await test.step('verify "preview" button renders html', async () => {
			await page.getByLabel('Preview', { exact: true }).click();
			const viewerFrame = app.workbench.positronViewer.getViewerFrame().frameLocator('iframe');
			await expect(viewerFrame.getByRole('heading', { name: 'Getting startedAnchor' })).toBeVisible({ timeout: 30000 });
		});

		await verifySplitEditor(page, 'basicRmd.rmd');
		await verifyOpenInNewWindow(page, 'This post examines the features');
	});


	test('Quarto Document [C1080700]', {
		tag: [tags.QUARTO]
	}, async function ({ app, page }) {
		await openFile(app, 'workspaces/quarto_basic/quarto_basic.qmd');

		await test.step('verify "preview" button renders html', async () => {
			await page.getByLabel('Preview', { exact: true }).click();
			const viewerFrame = app.workbench.positronViewer.getViewerFrame().frameLocator('iframe');
			await expect(viewerFrame.locator('h1')).toHaveText('Diamond sizes', { timeout: 30000 });
		});

		await verifySplitEditor(page, 'quarto_basic.qmd');
		await verifyOpenInNewWindow(page, 'Diamond sizes');
	});

	test('HTML Document [C1080701]', { tag: [tags.HTML] }, async function ({ app, page }) {
		await openFile(app, 'workspaces/dash-py-example/data/OilandGasMetadata.html');

		await test.step('verify "open in viewer" button renders html', async () => {
			await page.getByLabel('Open in Viewer').nth(1).click();
			const viewerFrame = page.locator('iframe.webview').contentFrame().locator('#active-frame').contentFrame();
			const cellLocator = app.web
				? viewerFrame.frameLocator('iframe').getByRole('cell', { name: 'Oil, Gas, and Other Regulated' })
				: viewerFrame.getByRole('cell', { name: 'Oil, Gas, and Other Regulated' });

			await expect(cellLocator).toBeVisible({ timeout: 30000 });
		});

		await verifySplitEditor(page, 'OilandGasMetadata.html');
		await verifyOpenInNewWindow(page, '<title> Oil &amp; Gas Wells - Metadata</title>');

	});

	test('Jupyter Notebook [C1080702]', {
		tag: [tags.NOTEBOOK],
		annotation: [{ type: 'info', description: 'electron test unable to interact with dropdown native menu' }],
	}, async function ({ app, page }) {
		await test.step('open jupyter notebook', async () => {
			await app.workbench.positronQuickaccess.openDataFile(
				path.join(app.workspacePathOrFolder, 'workspaces', 'large_r_notebook', 'spotify.ipynb')
			);
		});

		if (app.web) {
			await test.step('verify "customize notebook: toggle line numbers" adjusts settings (web only)', async () => {
				await verifyLineNumbersVisibility(page, false);
				await clickCustomizeNotebookMenuItem(page, 'Toggle Notebook Line Numbers');
				await verifyLineNumbersVisibility(page, true);
			});

			await test.step('verify "customize notebook: toggle breadcrumbs" adjusts settings (web only)', async () => {
				const breadcrumbs = page.locator('.monaco-breadcrumbs');

				await expect(breadcrumbs).toBeVisible();
				await clickCustomizeNotebookMenuItem(page, 'Toggle Breadcrumbs');
				await expect(breadcrumbs).not.toBeVisible();
			});
		}

		await verifySplitEditor(page, 'spotify.ipynb');
	});
});

async function openFile(app, filePath: string) {
	const fileName = path.basename(filePath);
	await test.step(`open file: ${fileName}`, async () => {
		await app.workbench.positronQuickaccess.openFile(path.join(app.workspacePathOrFolder, filePath));
	});
}

async function verifySplitEditor(page, tabName: string) {
	await test.step(`verify "split editor" button opens another tab`, async () => {
		// Split editor right
		await page.getByLabel('Split Editor Right', { exact: true }).click();
		await expect(page.getByRole('tab', { name: tabName })).toHaveCount(2);

		// Close one tab
		await page.getByRole('tab', { name: tabName }).getByLabel('Close').first().click();

		// Split editor down
		await page.keyboard.down('Alt');
		await page.getByLabel('Split Editor Down').nth(1).click();
		await page.keyboard.up('Alt');
		await expect(page.getByRole('tab', { name: tabName })).toHaveCount(2);
	});
}

async function verifyOpenInNewWindow(page, expectedText: string) {
	await test.step(`verify "open new window" contains: ${expectedText}`, async () => {
		const [newPage] = await Promise.all([
			page.context().waitForEvent('page'),
			page.getByLabel('Move into new window').nth(1).click(),
		]);
		await newPage.waitForLoadState();
		await expect(newPage.getByText(expectedText)).toBeVisible();
	});
}

async function clickCustomizeNotebookMenuItem(page, menuItem: string) {
	const role = menuItem.includes('Line Numbers') ? 'menuitemcheckbox' : 'menuitem';
	const dropdownButton = page.getByLabel('Customize Notebook...').nth(1);
	await dropdownButton.evaluate((button) => (button as HTMLElement).click());

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
