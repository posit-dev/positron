/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename,
});

// test is too heavy for web
test.describe('Large R Notebook', {
	tag: [tags.NOTEBOOKS, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('R - Large notebook execution', {
		tag: [tags.ARK]
	}, async function ({ app, openDataFile, r }) {
		test.setTimeout(720000);
		const { notebooksPositron } = app.workbench;
		const page = app.code.driver.currentPage;

		// open the large R notebook and run all cells
		await openDataFile(join('workspaces', 'large_r_notebook', 'spotify.ipynb'));
		await notebooksPositron.expectToBeVisible();
		await notebooksPositron.kernel.select('R');
		await notebooksPositron.clickActionBarButtton('Run All');

		// wait until every cell has finished executing (each badge shows its order)
		await expect
			.poll(async () => {
				const badges = await page.locator('.execution-order-badge').allTextContents();
				return badges.length > 0 && badges.every(badge => badge.trim() !== '-');
			}, { timeout: 480000, intervals: [5000] })
			.toBe(true);

		// the notebook produces many ggplot figures, which render natively as images
		// in the cell outputs; verify they all rendered
		await expect
			.poll(async () => await page.locator('[data-testid="cell-output"] img').count(),
				{ timeout: 60000, intervals: [5000] })
			.toBeGreaterThan(20);
	});
});
