/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});


// Note that this test is too heavy to pass on web and windows

test.describe('Large Python Notebook', () => {

	test('Python - Large notebook execution [C983592]', async function ({ app, python }) {
		test.setTimeout(480_000); // huge timeout because this is a heavy test
		const notebooks = app.workbench.positronNotebooks;


		await app.workbench.positronQuickaccess.openDataFile(join(app.workspacePathOrFolder, 'workspaces', 'large_py_notebook', 'spotify.ipynb'));
		await notebooks.selectInterpreter('Python Environments', process.env.POSITRON_PY_VER_SEL!);

		await app.code.driver.page.getByText('Run All').click();

		const stopExecutionLocator = app.code.driver.page.locator('a').filter({ hasText: 'Stop Execution' });
		await expect(stopExecutionLocator).toBeVisible();
		await expect(stopExecutionLocator).not.toBeVisible({ timeout: 120000 });

		await app.workbench.quickaccess.runCommand('notebook.focusTop');
		await app.code.driver.page.locator('span').filter({ hasText: 'import pandas as pd' }).locator('span').first().click();

		const allFigures: any[] = [];
		const uniqueLocators = new Set<string>();

		for (let i = 0; i < 6; i++) {

			// the second param to wheel (y) seems to be ignored so we send
			// more messages instead of one with a large y value
			await test.step('just scrolling...', async () => {
				for (let j = 0; j < 100; j++) {
					await app.code.driver.page.mouse.wheel(0, 1);
					await app.code.driver.page.waitForTimeout(100);
				}
			});

			const figureLocator = app.workbench.positronNotebooks.frameLocator.locator('.plot-container');
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
