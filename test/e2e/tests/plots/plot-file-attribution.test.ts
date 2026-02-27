/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Plot File Attribution', { tag: [tags.PLOTS] }, () => {

	test.describe('R Plot File Attribution', { tag: [tags.ARK] }, () => {

		const R_PLOT_FILE = 'plot-attribution-test.R';

		test.beforeEach(async function ({ app, sessions, hotKeys }) {
			await sessions.start('r');
			await hotKeys.stackedLayout();

			// Create the R script file in the workspace
			const filePath = path.join(app.workspacePathOrFolder, R_PLOT_FILE);
			fs.writeFileSync(filePath, 'plot(1:10)\n');
		});

		test.afterEach(async function ({ app, hotKeys }) {
			await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
			await expect(async () => {
				await hotKeys.clearPlots();
				await app.workbench.plots.waitForNoPlots({ timeout: 3000 });
			}).toPass({ timeout: 15000 });
		});

		test.afterAll(async function ({ cleanup }) {
			await cleanup.removeTestFiles([R_PLOT_FILE]);
		});

		test('R - Plot origin shows source file after line execution', async function ({ app, page, openFile }) {

			await test.step('Open R file and execute line with Cmd+Enter', async () => {
				await openFile(R_PLOT_FILE);
				await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
			});

			await test.step('Wait for plot to appear', async () => {
				await app.workbench.plots.waitForCurrentPlot();
			});

			await test.step('Verify origin file button shows correct filename', async () => {
				const originButton = page.locator('.plot-origin-file');
				await expect(originButton).toBeVisible({ timeout: 30000 });
				await expect(originButton).toHaveText(R_PLOT_FILE);
			});

			await test.step('Click origin button and verify editor opens the file', async () => {
				// Close the editor first so we can verify the click opens it
				await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');

				const originButton = page.locator('.plot-origin-file');
				await originButton.click();

				// Verify the editor opened the correct file
				const tab = page.getByRole('tab', { name: R_PLOT_FILE });
				await expect(tab).toBeVisible({ timeout: 15000 });
			});
		});

		test('R - Plot origin shows source file after source() command', async function ({ app, page, openFile, runCommand }) {

			await test.step('Open R file and source it', async () => {
				await openFile(R_PLOT_FILE);
				await runCommand('r.sourceCurrentFile');
			});

			await test.step('Wait for plot to appear', async () => {
				await app.workbench.plots.waitForCurrentPlot();
			});

			await test.step('Verify origin file button shows correct filename', async () => {
				const originButton = page.locator('.plot-origin-file');
				await expect(originButton).toBeVisible({ timeout: 30000 });
				await expect(originButton).toHaveText(R_PLOT_FILE);
			});

			await test.step('Click origin button and verify editor opens the file', async () => {
				// Close the editor first so we can verify the click opens it
				await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');

				const originButton = page.locator('.plot-origin-file');
				await originButton.click();

				// Verify the editor opened the correct file
				const tab = page.getByRole('tab', { name: R_PLOT_FILE });
				await expect(tab).toBeVisible({ timeout: 15000 });
			});
		});
	});

	test.describe('Python Plot File Attribution', () => {

		const PY_PLOT_FILE = 'plot-attribution-test.py';

		test.beforeEach(async function ({ app, sessions, hotKeys }) {
			await sessions.start('python');
			await hotKeys.stackedLayout();

			// Create the Python script file in the workspace
			const filePath = path.join(app.workspacePathOrFolder, PY_PLOT_FILE);
			fs.writeFileSync(filePath, [
				'import matplotlib.pyplot as plt',
				'plt.plot([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])',
				'plt.show()',
				''
			].join('\n'));
		});

		test.afterEach(async function ({ app, hotKeys }) {
			await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
			await expect(async () => {
				await hotKeys.clearPlots();
				await app.workbench.plots.waitForNoPlots({ timeout: 3000 });
			}).toPass({ timeout: 15000 });
		});

		test.afterAll(async function ({ cleanup }) {
			await cleanup.removeTestFiles([PY_PLOT_FILE]);
		});

		test('Python - Plot origin shows source file after line execution', async function ({ app, page, openFile }) {

			await test.step('Open Python file and execute lines with Cmd+Enter', async () => {
				await openFile(PY_PLOT_FILE);
				// Execute each line: import, plot, show
				for (let i = 0; i < 3; i++) {
					await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
					// Wait briefly for each line to be sent
					await page.waitForTimeout(500);
				}
			});

			await test.step('Wait for plot to appear', async () => {
				await app.workbench.plots.waitForCurrentPlot();
			});

			await test.step('Verify origin file button shows correct filename', async () => {
				const originButton = page.locator('.plot-origin-file');
				await expect(originButton).toBeVisible({ timeout: 30000 });
				await expect(originButton).toHaveText(PY_PLOT_FILE);
			});

			await test.step('Click origin button and verify editor opens the file', async () => {
				// Close the editor first so we can verify the click opens it
				await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');

				const originButton = page.locator('.plot-origin-file');
				await originButton.click();

				// Verify the editor opened the correct file
				const tab = page.getByRole('tab', { name: PY_PLOT_FILE });
				await expect(tab).toBeVisible({ timeout: 15000 });
			});
		});

		test('Python - Plot origin shows source file after Run Python File in Console', async function ({ app, page, openFile, runCommand }) {

			await test.step('Open Python file and run it in console', async () => {
				await openFile(PY_PLOT_FILE);
				await runCommand('python.execInConsole');
			});

			await test.step('Wait for plot to appear', async () => {
				await app.workbench.plots.waitForCurrentPlot();
			});

			await test.step('Verify origin file button shows correct filename', async () => {
				const originButton = page.locator('.plot-origin-file');
				await expect(originButton).toBeVisible({ timeout: 30000 });
				await expect(originButton).toHaveText(PY_PLOT_FILE);
			});

			await test.step('Click origin button and verify editor opens the file', async () => {
				// Close the editor first so we can verify the click opens it
				await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');

				const originButton = page.locator('.plot-origin-file');
				await originButton.click();

				// Verify the editor opened the correct file
				const tab = page.getByRole('tab', { name: PY_PLOT_FILE });
				await expect(tab).toBeVisible({ timeout: 15000 });
			});
		});
	});
});
