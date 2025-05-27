/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../_test.setup';


test.use({
	suiteId: __filename
});

test.describe('Publisher - Positron', { tag: [tags.WEB, tags.WIN, tags.PUBLISHER] }, () => {
	test.afterAll('Delete file from Posit Connect', async function ({ app }) {
		await app.workbench.positConnect.deleteUserContent();
	});

	test('Verify Publisher functionality in Positron with Shiny app deployment as example', async function ({ app, page, openFile }) {
		test.slow();
		await test.step('Open file', async () => {
			await openFile('workspaces/shiny-py-example/app.py');
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

		await test.step('Add files to deployment file (after app.py) and save', async () => {
			const files = ['shared.py', 'styles.css', 'tips.csv'];
			await app.workbench.positConnect.selectFilesForDeploy(files);
		});

		// This step was tricky due to button being inside iframe --> iframe --> shadow DOM (for any left pane interactivity, check this approach)
		const outerFrame = page.frameLocator('iframe.webview.ready');
		const innerFrame = outerFrame.frameLocator('iframe#active-frame');
		const deployButton = innerFrame.locator('vscode-button[data-automation="deploy-button"] >>> button');

		await test.step('Click on Deploy Your Project button', async () => {
			await deployButton.click();
		});

		await test.step('Click on View Log', async () => {
			const viewLogLink = innerFrame.locator('a.webview-link', { hasText: 'View Log' });
			await viewLogLink.waitFor({ state: 'visible' });
			await viewLogLink.click();
		});

		// This step verifies deployment process kicks in. See discussion in #connect channel, posted 05/23.
		await test.step('Verify deployments process gets kicked in by Publisher (out of scope: whether deployment succeeds', async () => {
			// Not needed thanks to PR 7840, but this is an example of implementation
			// await app.workbench.popups.closeSpecificToast('Import your settings from Visual Studio Code into Positron?');
			await page.getByRole('button', { name: 'Maximize Panel' }).click();
			// The next two await expects are a bit redundant on purpose. If "Deploy Bundle" isn't visible, test should quickly fail (5secs).
			await expect(page.locator('span.monaco-highlighted-label:has-text("Deploy Bundle")')).toBeVisible({ timeout: 5000 });
			// Then, checkmark next to it might take a bit long to appear, which is expected.
			await expect(page.locator('.monaco-list-row:has-text("Deploy Bundle") .custom-view-tree-node-item-icon.codicon.codicon-check')).toBeVisible({ timeout: 90000 });
		});
	});
});
