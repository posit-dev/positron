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
			await app.workbench.layouts.enterLayout('fullSizedPanel');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
		});

		test('evaluate R expression returns JSON result', async ({ app, page }) => {
			await app.workbench.quickaccess.runCommand('workbench.action.evaluateCode', { keepOpen: true });

			const inputBox = page.locator('.quick-input-widget .quick-input-box input');
			await expect(inputBox).toBeVisible();
			await inputBox.fill('list(a = 1, b = TRUE)');
			await page.keyboard.press('Enter');

			// Verify the editor opens with input and result sections
			const editorContent = page.locator('[id="workbench.parts.editor"]').getByRole('code');
			await expect(editorContent).toContainText('## Input');
			await expect(editorContent).toContainText('list(a = 1, b = TRUE)');
			await expect(editorContent).toContainText('## Result');
			await expect(editorContent).toContainText('"a"');
			await expect(editorContent).toContainText('"b"');
		});

		test('evaluate R expression with output', async ({ app, page }) => {
			// isTRUE(cat('oatmeal')) prints 'oatmeal' and returns FALSE
			await app.workbench.quickaccess.runCommand('workbench.action.evaluateCode', { keepOpen: true });

			const inputBox = page.locator('.quick-input-widget .quick-input-box input');
			await expect(inputBox).toBeVisible();
			await inputBox.fill("isTRUE(cat('oatmeal'))");
			await page.keyboard.press('Enter');

			const editorContent = page.locator('[id="workbench.parts.editor"]').getByRole('code');
			await expect(editorContent).toContainText('## Input');
			await expect(editorContent).toContainText("isTRUE(cat('oatmeal'))");
			await expect(editorContent).toContainText('## Result');
			await expect(editorContent).toContainText('false');
			await expect(editorContent).toContainText('## Output');
			await expect(editorContent).toContainText('oatmeal');
		});
	});

	test.describe('Python', () => {
		test.beforeEach(async function ({ app, python }) {
			await app.workbench.layouts.enterLayout('fullSizedPanel');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
		});

		test('evaluate Python expression returns JSON result', async ({ app, page }) => {
			await app.workbench.quickaccess.runCommand('workbench.action.evaluateCode', { keepOpen: true });

			const inputBox = page.locator('.quick-input-widget .quick-input-box input');
			await expect(inputBox).toBeVisible();
			await inputBox.fill('{"a": 1, "b": True}');
			await page.keyboard.press('Enter');

			const editorContent = page.locator('[id="workbench.parts.editor"]').getByRole('code');
			await expect(editorContent).toContainText('## Input');
			await expect(editorContent).toContainText('{"a": 1, "b": True}');
			await expect(editorContent).toContainText('## Result');
			await expect(editorContent).toContainText('"a"');
			await expect(editorContent).toContainText('"b"');
		});

		test('evaluate Python expression with output', async ({ app, page }) => {
			// print('hello') or 42 prints 'hello' and returns 42
			await app.workbench.quickaccess.runCommand('workbench.action.evaluateCode', { keepOpen: true });

			const inputBox = page.locator('.quick-input-widget .quick-input-box input');
			await expect(inputBox).toBeVisible();
			await inputBox.fill("print('hello') or 42");
			await page.keyboard.press('Enter');

			const editorContent = page.locator('[id="workbench.parts.editor"]').getByRole('code');
			await expect(editorContent).toContainText('## Input');
			await expect(editorContent).toContainText("print('hello') or 42");
			await expect(editorContent).toContainText('## Result');
			await expect(editorContent).toContainText('42');
			await expect(editorContent).toContainText('## Output');
			await expect(editorContent).toContainText('hello');
		});
	});
});
