/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename,
	snapshots: false
});

// test is too heavy for web
test.describe('Large R Notebook', {
	tag: [tags.NOTEBOOKS, tags.WIN]
}, () => {

	test('R - Large notebook execution', {
		tag: [tags.ARK]
	}, async function ({ app, openDataFile, runCommand, r }) {
		test.slow();
		const { notebooks, layouts } = app.workbench;

		// open the large R notebook and run all cells
		await openDataFile(join(app.workspacePathOrFolder, 'workspaces', 'large_r_notebook', 'spotify.ipynb'));
		await notebooks.selectInterpreter('R');
		await notebooks.runAllCells(120000);

		// scroll through the notebook and count unique plot outputs
		await layouts.enterLayout('notebook');
		await runCommand('notebook.focusTop');
		await app.code.driver.page.locator('span').filter({ hasText: 'library(dplyr)' }).locator('span').first().click();

		const allFigures: any[] = [];
		const uniqueLocators = new Set<string>();

		for (let i = 0; i < 6; i++) {

			for (let j = 0; j < 100; j++) {
				// second param to mouse.wheel is not processed correctly so loop is needed
				await app.code.driver.page.mouse.wheel(0, 1);
			}

			const figureLocator = app.workbench.notebooks.frameLocator.locator('.output_container');
			const figures = await figureLocator.all();

			if (figures!.length > 0) {
				for (const figure of figures!) {
					if (!uniqueLocators.has(figure.toString())) {
						allFigures.push(figure);
						uniqueLocators.add(figure.toString());
					}
				}
			}
		}

		expect(allFigures.length).toBeGreaterThan(20);
	});
});
