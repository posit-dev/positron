/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

// Ark resolves names in a cell against the cells above it, which it only can
// do when it gets the notebook's cells in order.
test.describe('Positron Notebooks: R Cross-Cell Go to Definition', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.ARK, tags.WEB, tags.WIN]
}, () => {

	test('Go to Definition in an R cell lands on a definition in an earlier cell', async function ({ app, page }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.openNotebook(path.join('workspaces', 'cross_cell_definition', 'cross_cell_definition.ipynb'));
		await notebooksPositron.kernel.select('R');

		// Retry until Ark has the cells: before that, F12 finds no definition.
		await expect(async () => {
			// `my_r_helper(21)` in the second cell, cursor on its first column.
			await notebooksPositron.editModeAtIndex(1);
			await page.keyboard.press('Home');
			await page.keyboard.press('F12');
			// `my_r_helper <- function(x) {` in the first cell.
			await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: true, timeout: 5000 });
		}).toPass({ timeout: 60000 });
	});
});
