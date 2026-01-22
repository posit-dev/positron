/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output', {
	tag: [tags.WEB, tags.WIN, tags.QUARTO]
}, () => {

	test.beforeAll(async function ({ app, python, settings }) {
		// Start Python first to ensure a runtime is available
		// The python fixture handles this, but we need to ensure it completes

		// Enable the Quarto inline output feature
		// Use reload to ensure the feature initializes properly
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true
		}, { reload: true });
	});

	test.afterAll(async function ({ settings }) {
		// Disable the feature after tests
		await settings.set({
			'positron.quarto.inlineOutput.enabled': false
		});
	});

	test('Python - Verify inline output appears after running a code cell', async function ({ app, openFile }) {
		const page = app.code.driver.page;

		// Open a Quarto document with Python code
		await openFile(join('workspaces', 'quarto_python', 'report.qmd'));

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to recognize this as a Quarto document
		// The status bar indicator appears when the feature is enabled and a .qmd file is open
		const statusBarIndicator = page.locator('.statusbar-item').filter({ hasText: /Quarto|Python/ });
		await expect(statusBarIndicator.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Use "Go to Line" command to position cursor in the Python code cell
		// The file has frontmatter (lines 1-9), markdown (lines 11-13), then code cell starting line 15
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('17');
		await page.keyboard.press('Enter');

		// Wait for cursor to be positioned
		await page.waitForTimeout(500);

		// Run the current cell using the command
		// This will start the Quarto kernel if not already running
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear
		// The output should appear in a view zone with class 'quarto-inline-output'
		// Use longer timeout since kernel startup may take time
		const inlineOutput = page.locator('.quarto-inline-output');

		// Monaco virtualizes content - the view zone won't be in the DOM until we scroll to it.
		// The cell ends around line 25, so scroll to line 30 to ensure the output area is visible.
		// We need to poll/retry since the output takes time to appear after kernel execution.
		await expect(async () => {
			// Scroll editor to show the area after the cell where output appears
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('30');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);

			// Now check if the output element is visible
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify the output container has content
		const outputContent = inlineOutput.locator('.quarto-output-content');
		await expect(outputContent).toBeVisible({ timeout: 10000 });

		// Verify there is at least one output item
		const outputItem = inlineOutput.locator('.quarto-output-item');
		await expect(outputItem.first()).toBeVisible({ timeout: 10000 });
	});

	test('Python - Verify inline output persists after closing and reopening file', async function ({ app, openFile }) {
		const page = app.code.driver.page;
		const filePath = join('workspaces', 'quarto_python', 'report.qmd');

		// Open a Quarto document with Python code
		await openFile(filePath);

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to initialize
		const statusBarIndicator = page.locator('.statusbar-item').filter({ hasText: /Quarto|Python/ });
		await expect(statusBarIndicator.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the Python code cell (line 17)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('17');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Run the current cell
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for inline output to appear
		const inlineOutput = page.locator('.quarto-inline-output');

		// Poll until output appears (includes kernel startup time)
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('30');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// Verify output content is present
		const outputContent = inlineOutput.locator('.quarto-output-content');
		await expect(outputContent).toBeVisible({ timeout: 10000 });

		// Close the file
		await app.workbench.quickaccess.runCommand('workbench.action.closeActiveEditor');

		// Wait for editor to close
		await page.waitForTimeout(500);

		// Reopen the same file
		await openFile(filePath);

		// Wait for the editor to be ready again
		await expect(editor).toBeVisible({ timeout: 10000 });
		await page.waitForTimeout(1000);

		// The cached output should still be visible after reopening
		// Use retry pattern since loading is async
		await expect(async () => {
			// Scroll to where the output should be (after cell ends around line 25)
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('30');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);

			// Check if the output is visible
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 30000 });

		// Verify the content is present
		await expect(outputContent).toBeVisible({ timeout: 10000 });
	});
});
