/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

// Generates a simple matplotlib plot
const matplotlibPlotCode = `import matplotlib.pyplot as plt
plt.figure(figsize=(3, 2))
plt.plot([1, 2, 3], [1, 4, 9])
plt.show()`;

test.describe('Positron Notebooks: Copy Output Image', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.WIN, tags.WEB]
}, () => {

	test.beforeEach(async function ({ app, python }) {
		const { notebooks, notebooksPositron } = app.workbench;
		await app.workbench.layouts.enterLayout('notebook');
		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await notebooksPositron.kernel.select('Python');
	});

	test('Copy Image appears in output context menu for plot output', async function ({ app, headless }) {
		test.skip(!!headless, 'Clipboard image tests require headed mode');

		const { notebooksPositron } = app.workbench;

		await test.step('Execute cell that generates a plot', async () => {
			await notebooksPositron.addCodeToCell(0, matplotlibPlotCode, { run: true, waitForSpinner: true });
		});

		await test.step('Verify plot image appears in output', async () => {
			const cellOutput = notebooksPositron.cell.nth(0).getByTestId('cell-output');
			await expect(cellOutput.locator('img')).toBeVisible();
		});

		await test.step('Right-click output and verify Copy Image option', async () => {
			const cellOutput = notebooksPositron.cell.nth(0).getByTestId('cell-output');
			await cellOutput.click({ button: 'right' });
			const copyImageOption = app.code.driver.page.locator('button.custom-context-menu-item', { hasText: 'Copy Image' });
			await expect(copyImageOption).toBeVisible();
		});

		await test.step('Click Copy Image and verify clipboard has image data', async () => {
			const copyImageOption = app.code.driver.page.locator('button.custom-context-menu-item', { hasText: 'Copy Image' });
			await copyImageOption.click();

			// Allow time for clipboard write
			await app.code.wait(500);

			const clipboardImageBuffer = await app.workbench.clipboard.getClipboardImage();
			expect(clipboardImageBuffer).not.toBeNull();
		});
	});

	test('Cmd+C copies image when cell with plot is active in command mode', async function ({ app, hotKeys, headless }) {
		test.skip(!!headless, 'Clipboard image tests require headed mode');

		const { notebooksPositron } = app.workbench;

		await test.step('Execute cell that generates a plot', async () => {
			await notebooksPositron.addCodeToCell(0, matplotlibPlotCode, { run: true, waitForSpinner: true });
		});

		await test.step('Verify plot image appears in output', async () => {
			const cellOutput = notebooksPositron.cell.nth(0).getByTestId('cell-output');
			await expect(cellOutput.locator('img')).toBeVisible();
		});

		await test.step('Exit edit mode and copy with Cmd+C', async () => {
			// Press Escape to enter command mode
			await app.code.driver.page.keyboard.press('Escape');

			// Clear clipboard first
			await app.workbench.clipboard.clearClipboard();

			// Cmd+C should copy the image since cell has image output
			await hotKeys.copy();

			// Allow time for clipboard write
			await app.code.wait(500);

			const clipboardImageBuffer = await app.workbench.clipboard.getClipboardImage();
			expect(clipboardImageBuffer).not.toBeNull();
		});
	});
});
