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
	tag: [tags.NOTEBOOKS, tags.PLOTS, tags.PYTHON]
}, () => {

	test.afterAll(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Python - Large notebook execution', async function ({ app, openDataFile, runCommand, python }) {
		test.slow();
		const { notebooks, layouts } = app.workbench;

		// open the large Python notebook and run all cells
		await openDataFile(join('workspaces', 'large_py_notebook', 'spotify.ipynb'));
		await notebooks.selectInterpreter('Python');
		await notebooks.runAllCells({ timeout: 12000 });

		// scroll through the notebook until its plot outputs have rendered
		await layouts.enterLayout('notebook');
		// Leave focus on the cell list (not a cell editor) so PageDown pages through cells.
		await runCommand('notebook.focusTop');

		// Outputs render into the webview as their cells scroll into view, and stay there once
		// rendered, so keep paging down until enough plots exist rather than paging a fixed amount.
		const figures = notebooks.frameLocator.locator('.plot-container');
		await expect(async () => {
			await app.code.driver.currentPage.keyboard.press('PageDown');
			expect(await figures.count()).toBeGreaterThan(15);
		}).toPass({ timeout: 90000 });
	});
});
