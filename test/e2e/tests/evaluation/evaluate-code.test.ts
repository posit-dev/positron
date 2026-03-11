/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Evaluate Code', {
	tag: [tags.CRITICAL, tags.WEB]
}, () => {

	test.describe('R', {
		tag: [tags.ARK]
	}, () => {
		test.beforeEach(async function ({ app, r }) {
			await app.workbench.layouts.enterLayout('stacked');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
		});

		test('evaluate R expression returns JSON result', async function ({ app, page }) {
			await test.step('Submit code for evaluation', async () => {
				await app.workbench.quickaccess.runCommand('workbench.action.evaluateCode', { keepOpen: true });
				await app.workbench.quickInput.waitForQuickInputOpened();
				await app.workbench.quickInput.type('list(a = 1, b = TRUE)');
				await page.keyboard.press('Enter');
			});

			await test.step('Verify editor content', async () => {
				const viewLines = page.locator('[id="workbench.parts.editor"] .view-lines');
				await expect(viewLines).toContainText('## Input', { timeout: 30000 });
				await expect(viewLines).toContainText('list(a = 1, b = TRUE)');
				await expect(viewLines).toContainText('## Result');
				await expect(viewLines).toContainText('"a"');
				await expect(viewLines).toContainText('"b"');
			});
		});

		test('evaluate R expression with output', async function ({ app, page }) {
			// isTRUE(cat('oatmeal')) prints 'oatmeal' and returns FALSE
			await test.step('Submit code for evaluation', async () => {
				await app.workbench.quickaccess.runCommand('workbench.action.evaluateCode', { keepOpen: true });
				await app.workbench.quickInput.waitForQuickInputOpened();
				await app.workbench.quickInput.type("isTRUE(cat('oatmeal'))");
				await page.keyboard.press('Enter');
			});

			await test.step('Verify editor content', async () => {
				const viewLines = page.locator('[id="workbench.parts.editor"] .view-lines');
				await expect(viewLines).toContainText('## Input', { timeout: 30000 });
				await expect(viewLines).toContainText("isTRUE(cat('oatmeal'))");
				await expect(viewLines).toContainText('## Result');
				await expect(viewLines).toContainText('false');
				await expect(viewLines).toContainText('## Output');
				await expect(viewLines).toContainText('oatmeal');
			});
		});
	});

	test.describe('Python', () => {
		test.beforeEach(async function ({ app, python }) {
			await app.workbench.layouts.enterLayout('stacked');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
		});

		test('evaluate Python expression returns JSON result', async function ({ app, page }) {
			await test.step('Submit code for evaluation', async () => {
				await app.workbench.quickaccess.runCommand('workbench.action.evaluateCode', { keepOpen: true });
				await app.workbench.quickInput.waitForQuickInputOpened();
				await app.workbench.quickInput.type('{"a": 1, "b": True}');
				await page.keyboard.press('Enter');
			});

			await test.step('Verify editor content', async () => {
				const viewLines = page.locator('[id="workbench.parts.editor"] .view-lines');
				await expect(viewLines).toContainText('## Input', { timeout: 30000 });
				await expect(viewLines).toContainText('{"a": 1, "b": True}');
				await expect(viewLines).toContainText('## Result');
				await expect(viewLines).toContainText('"a"');
				await expect(viewLines).toContainText('"b"');
			});
		});

		test('evaluate Python expression with output', async function ({ app, page }) {
			// print('hello') or 42 prints 'hello' and returns 42
			await test.step('Submit code for evaluation', async () => {
				await app.workbench.quickaccess.runCommand('workbench.action.evaluateCode', { keepOpen: true });
				await app.workbench.quickInput.waitForQuickInputOpened();
				await app.workbench.quickInput.type("print('hello') or 42");
				await page.keyboard.press('Enter');
			});

			await test.step('Verify editor content', async () => {
				const viewLines = page.locator('[id="workbench.parts.editor"] .view-lines');
				await expect(viewLines).toContainText('## Input', { timeout: 30000 });
				await expect(viewLines).toContainText("print('hello') or 42");
				await expect(viewLines).toContainText('## Result');
				await expect(viewLines).toContainText('42');
				await expect(viewLines).toContainText('## Output');
				await expect(viewLines).toContainText('hello');
			});
		});
	});
});
