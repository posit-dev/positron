/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename,
});

// test is too heavy for web
test.describe('Large Python Notebook', {
	tag: [tags.NOTEBOOKS, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Python - Large notebook execution', async function ({ app, openDataFile, python }) {
		test.setTimeout(720000);
		const { notebooksPositron } = app.workbench;
		const page = app.code.driver.currentPage;

		// open the large Python notebook and run all cells
		await openDataFile(join('workspaces', 'large_py_notebook', 'spotify.ipynb'));
		await notebooksPositron.expectToBeVisible();
		await notebooksPositron.kernel.select('Python');
		await notebooksPositron.clickActionBarButtton('Run All');

		// wait until every cell has finished executing (each badge shows its order)
		await expect
			.poll(async () => {
				const badges = await page.locator('.execution-order-badge').allTextContents();
				return badges.length > 0 && badges.every(badge => badge.trim() !== '-');
			}, { timeout: 180000, intervals: [5000] })
			.toBe(true);

		// scroll once through the notebook so lazily-rendered output webviews materialize
		await page.locator('[data-testid="notebook-cell"]').first().hover();
		for (let i = 0; i < 20; i++) {
			await page.mouse.wheel(0, 1000);
			await page.waitForTimeout(300);
		}

		// the notebook produces many plotly figures. Count them by rendered output
		// size in the cell DOM (plotly outputs reserve 500px+; text and dataframe
		// outputs stay under ~200px). Per-frame webview scans are not used here:
		// frame contents come and go with the viewport, and scanning hundreds of
		// frames repeatedly is what timed this test out in CI.
		await expect
			.poll(async () => {
				const heights = await page.locator('[data-testid="cell-output"]').evaluateAll(
					els => els.map(el => el.getBoundingClientRect().height));
				return heights.filter(height => height > 400).length;
			}, { timeout: 120000, intervals: [5000] })
			.toBeGreaterThan(15);

		// confirm the plotly renderer actually painted at least one figure (a single
		// bounded pass per attempt, exiting at the first plot found)
		await expect
			.poll(async () => {
				for (const frame of page.frames()) {
					if (!frame.url().startsWith('vscode-webview://')) {
						continue;
					}
					if (await frame.locator('.plot-container').count().catch(() => 0) > 0) {
						return true;
					}
				}
				return false;
			}, { timeout: 120000, intervals: [10000] })
			.toBe(true);
	});
});
