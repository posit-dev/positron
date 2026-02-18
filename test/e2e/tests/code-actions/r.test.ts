/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path, { join } from 'path';
import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';
import { fail } from 'assert';

test.use({
	suiteId: __filename
});

test.describe('R Code Actions', { tag: [tags.EDITOR, tags.WIN, tags.WEB, tags.ARK] }, () => {

	test.afterEach(async function ({ app, hotKeys, cleanup }) {
		await hotKeys.closeAllEditors();
		await cleanup.discardAllChanges();
	});


	test('R - Can execute code in untitled file with Ctrl+Enter', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/11533' }]
	}, async ({ app, r, page }) => {
		const { editors, quickaccess, quickInput, console } = app.workbench;

		// Create a new untitled file
		await editors.newUntitledFile();

		// Change language mode to R
		await quickaccess.runCommand('workbench.action.editor.changeLanguageMode', { keepOpen: true });
		await quickInput.waitForQuickInputOpened();
		await quickInput.type('R');
		await quickInput.selectQuickInputElementContaining('R', { timeout: 5000 });
		await quickInput.waitForQuickInputClosed();

		// Type R code
		await app.workbench.editor.type('1 + 1');

		// Execute with Ctrl/Cmd+Enter
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');

		// Verify the result appears in the console
		await console.waitForConsoleContents('[1] 2');
	});


	test("R - Can insert a Roxygen skeleton", async function ({ app, r, openFile }) {

		const fileName = 'supermarket-sales.r';
		await openFile(join('workspaces/read-xlsx-r/', fileName));

		const termLocator = await app.workbench.editor.clickOnTerm(fileName, 'get_data_from_excel', 7, true);

		await termLocator.hover();

		await app.code.driver.page.locator('.codicon-light-bulb').click();

		const generateTemplate = app.code.driver.page.getByText('Generate a roxygen template');

		await expect(async () => {

			try {
				await generateTemplate.hover({ timeout: 2000 });
				await generateTemplate.click({ timeout: 2000 });
			} catch (e) {
				// workaround for click problem
				await app.code.driver.page.mouse.move(0, 0);
				throw e;
			}
		}).toPass({ timeout: 30000 });

		const line7 = await app.workbench.editor.getLine(fileName, 7);
		expect(line7).toBe('#\' Title');

		const line12 = await app.workbench.editor.getLine(fileName, 12);
		expect(line12).toBe('#\' @examples');

	});


	test("R - Can fold code", async function ({ app, r, hotKeys }) {

		const fileName = 'folding.R';
		await test.step('Create test file', async () => {

			await app.workbench.quickaccess.runCommand('workbench.action.files.newUntitledFile', { keepOpen: false });

			await hotKeys.save();

			await app.workbench.quickInput.waitForQuickInputOpened();

			await app.workbench.quickInput.type(path.join(app.workspacePathOrFolder, fileName));

			await app.workbench.quickInput.clickOkButton();

			await app.workbench.quickInput.waitForQuickInputClosed();

			await app.workbench.editor.selectTabAndType(fileName, collapseText);
		});

		await test.step('Single hash collpase', async () => {
			await app.code.driver.page.locator('.codicon-folding-expanded').first().click();

			await expect(app.code.driver.page.locator('.codicon-folding-collapsed')).toHaveCount(1);

			try {
				const line2 = await app.workbench.editor.getLine(fileName, 2);
				fail(`Expected line 2 to be folded, but got: ${line2}`);
			} catch { } // expected error when line is folded

			await app.code.driver.page.locator('.codicon-folding-collapsed').first().click();

			await expect(app.code.driver.page.locator('.codicon-folding-expanded')).toHaveCount(4);
		});

		await test.step('Double hash collpase', async () => {

			await app.code.driver.page.locator('.codicon-folding-expanded').nth(1).click();

			await expect(app.code.driver.page.locator('.codicon-folding-collapsed')).toHaveCount(1);

			try {
				const line4 = await app.workbench.editor.getLine(fileName, 4);
				fail(`Expected line 4 to be folded, but got: ${line4}`);
			} catch { } // expected error when line is folded

			const line9 = await app.workbench.editor.getLine(fileName, 9);
			expect(line9).toBe('## Section 1.2 ----');

			await app.code.driver.page.locator('.codicon-folding-collapsed').first().click();

			await expect(app.code.driver.page.locator('.codicon-folding-expanded')).toHaveCount(4);
		});

		await test.step('Triple hash collpase', async () => {
			await app.code.driver.page.locator('.codicon-folding-expanded').nth(2).click();

			await expect(app.code.driver.page.locator('.codicon-folding-collapsed')).toHaveCount(1);

			try {
				const line6 = await app.workbench.editor.getLine(fileName, 6);
				fail(`Expected line 6 to be folded, but got: ${line6}`);
			} catch { } // expected error when line is folded

			await app.code.driver.page.locator('.codicon-folding-collapsed').first().click();

			await expect(app.code.driver.page.locator('.codicon-folding-expanded')).toHaveCount(4);

			const line7 = await app.workbench.editor.getLine(fileName, 7);
			expect(line7).toBe('#### Section 1.1.1.1 ----');
		});


	});
});

const collapseText =
	`# Section 1 ----

## Section 1.1 ----

### Section 1.1.1 ----

#### Section 1.1.1.1 ----

## Section 1.2 ----`;
