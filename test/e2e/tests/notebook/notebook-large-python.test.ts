/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename,
});

// test is too heavy for web
test.describe.skip('Large Python Notebook', {
	tag: [tags.NOTEBOOKS, tags.WIN]
}, () => {

	test.afterAll(async function ({ hotKeys }) {
		// If we don't close the editor, the test teardown fails
		await hotKeys.closeAllEditors();
	});

	test('Python - Large notebook execution', async function ({ app, python }) {
		test.slow();
		const notebooks = app.workbench.notebooks;

		await app.workbench.quickaccess.openDataFile(join(app.workspacePathOrFolder, 'workspaces', 'large_py_notebook', 'spotify.ipynb'));
		await notebooks.selectInterpreter('Python');

		await notebooks.runAllCells(120000);

		await app.workbench.layouts.enterLayout('notebook');

		await app.workbench.quickaccess.runCommand('notebook.focusTop');
		await app.code.driver.page.locator('span').filter({ hasText: 'import pandas as pd' }).locator('span').first().click();

		const allFigures: any[] = [];
		const uniqueLocators = new Set<string>();

		for (let i = 0; i < 12; i++) {

			await app.code.driver.page.keyboard.press('PageDown');

			const figureLocator = app.workbench.notebooks.frameLocator.locator('.plot-container');
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

		expect(allFigures.length).toBeGreaterThan(15);
	});
});
