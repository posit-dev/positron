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

		// the notebook produces many plotly figures, each rendered in its own output
		// webview. Output webviews materialize lazily as they scroll into view, so
		// scroll through the notebook and count distinct frames containing a plot.
		const plotFrameUrls = new Set<string>();
		await page.locator('[data-testid="notebook-cell"]').first().hover();
		for (let i = 0; i < 20 && plotFrameUrls.size <= 15; i++) {
			for (const frame of page.frames()) {
				const url = frame.url();
				if (!url.startsWith('vscode-webview://') || plotFrameUrls.has(url)) {
					continue;
				}
				if (await frame.locator('.plot-container').count().catch(() => 0) > 0) {
					plotFrameUrls.add(url);
				}
			}
			await page.mouse.wheel(0, 1000);
			await page.waitForTimeout(1000);
		}
		expect(plotFrameUrls.size).toBeGreaterThan(15);
	});
});
