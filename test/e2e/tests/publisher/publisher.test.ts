/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Publisher - Positron', { tag: [tags.WEB, tags.WIN, tags.PUBLISHER] }, () => {
	test.slow();
	test.afterAll('Debug deletion of file', async function ({ app }) {
		await app.workbench.positConnect.deleteUserContent();
	});

	test('Verify Publisher functionality in Positron with Shiny app deployment as example', async function ({ app, logger, page, python }, testInfo) {
		test.slow();
		await test.step('Open file', async () => {
			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'shiny-py-example', 'app.py'));
		});

		await test.step('Click on Publish button', async () => {
			const deployPublisherButton = page.getByRole('button', { name: 'Deploy with Posit Publisher' });
			await deployPublisherButton.click();
		});

		await test.step('Quick-input shiny-py-example unique name', async () => {
			await app.workbench.quickInput.waitForQuickInputOpened();
			await app.workbench.quickInput.type('shiny-py-example');
			await page.keyboard.press('Enter');
		});

		await test.step('Enter Connect server and API key', async () => {
			await app.workbench.quickInput.type(process.env.E2E_CONNECT_SERVER!);
			await page.keyboard.press('Enter');
			await app.workbench.quickInput.type(process.env.E2E_CONNECT_APIKEY!);
			await page.keyboard.press('Enter');
		});

		await test.step('Quick-input shiny-py-example', async () => {
			await app.workbench.quickInput.type('shiny-py-example');
			await page.keyboard.press('Enter');
		});

		// This is a long step to insert the other files into the toml file, after last line.
		await test.step('Add shared.py, styles.css, tips.csv to deployment-***.toml and save', async () => {
			const editorContainer = page.locator('[id="workbench\\.parts\\.editor"]');
			const dynamicTomlLineRegex = /deployment-.*?\.toml/;
			const targetLine = editorContainer.locator('.view-line').filter({ hasText: dynamicTomlLineRegex });

			await targetLine.scrollIntoViewIfNeeded({ timeout: 20000 });
			await expect(targetLine).toBeVisible({ timeout: 10000 });

			await targetLine.click();
			await page.keyboard.press('End');
			await page.keyboard.type(',');

			await page.keyboard.press('Enter');
			await page.keyboard.type("'/shared.py',");
			await page.keyboard.press('Enter');
			await page.keyboard.type("'/styles.css',");
			await page.keyboard.press('Enter');
			await page.keyboard.type("'/tips.csv'");

			const saveButton = page.locator('.action-bar-button-icon.codicon.codicon-positron-save').first();
			await saveButton.click();
		});

		// This step was tricky due to button being inside iframe --> iframe --> shadow DOM (for any left pane interactivity, check this approach)
		const outerFrame = page.frameLocator('iframe.webview.ready');
		const innerFrame = outerFrame.frameLocator('iframe#active-frame');
		const deployButton = innerFrame.locator('vscode-button[data-automation="deploy-button"] >>> button');

		await test.step('Click on Deploy Your Project button', async () => {
			await deployButton.waitFor({ state: 'visible' });
			await deployButton.click();
		});

		await test.step('Click on View Log', async () => {
			const viewLogLink = innerFrame.locator('a.webview-link', { hasText: 'View Log' });
			await viewLogLink.waitFor({ state: 'visible' });
			await viewLogLink.click();
		});


		// This step may be flacky due to deployment toast sometimes showing failure despite successful deployment
		await test.step('Verify deployment was successful', async () => {
			const toast = page.locator('.notification-list-item-message span', {
				hasText: 'Deployment was successful',
			});
			await toast.waitFor({ state: 'visible', timeout: 120000 });
			await expect(toast).toBeVisible();
		});
	});
});
