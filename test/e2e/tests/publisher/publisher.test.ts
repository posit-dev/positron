/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

// This test aims to verify basic Publisher's functionality
test('Verify Publisher functionality in Positron with Shiny app deployment as example', { tag: [tags.WEB, tags.WIN, tags.QUARTO] }, async function ({ app, openFile, logger, page, python }, testInfo) {

	await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'shiny-py-example', 'app.py'));

	const deployPublisherButton = page.getByRole('button', { name: 'Deploy with Posit Publisher' });
	await deployPublisherButton.click();

	await app.workbench.quickInput.waitForQuickInputOpened();
	await app.workbench.quickInput.type('shiny-py-example');
	await page.keyboard.press('Enter');

	await app.workbench.quickInput.type(process.env.E2E_CONNECT_SERVER!);
	await page.keyboard.press('Enter');

	await app.workbench.quickInput.type(process.env.E2E_CONNECT_APIKEY!);
	await page.keyboard.press('Enter');

	await app.workbench.quickInput.type('shiny-py-example');
	await page.keyboard.press('Enter');

	// shadow dom note

	const editorContainer = page.locator('[id="workbench\\.parts\\.editor"]');
	const dynamicTomlLineRegex = /deployment-.*?\.toml/;
	// if someone changes the structure of the toml file, this regex will not work
	const targetLine = editorContainer.locator('.view-line').filter({ hasText: dynamicTomlLineRegex });

	await targetLine.scrollIntoViewIfNeeded({ timeout: 20000 });
	await expect(targetLine).toBeVisible({ timeout: 10000 });

	await targetLine.click();

	await page.keyboard.press('End');
	await page.keyboard.type(',')

	await page.keyboard.press('Enter');
	await page.keyboard.type("'/shared.py',");
	await page.keyboard.press('Enter');
	await page.keyboard.type("'/styles.css',");
	await page.keyboard.press('Enter');
	await page.keyboard.type("'/tips.csv'");

	const saveButton = page.locator('.action-bar-button-icon.codicon.codicon-positron-save').first();
	await saveButton.click(); // up to here it works

	// below doesn't work: I've tried multiple ways to click the button
	const frame = page.frameLocator('iframe[src*="vscode-webview://"][src*="index.html"]');
	await frame.locator('vscode-button[data-automation="deploy-button"] >>> button.control').click();



});
