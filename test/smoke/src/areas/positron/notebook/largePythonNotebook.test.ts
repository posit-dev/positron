/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { Application, PositronNotebooks, PositronPythonFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';
import { expect } from '@playwright/test';

// This test is too time consuming to pass on web
describe('Large Notebooks #web #win', () => {
	setupAndStartApp();

	describe('Large Python Notebook', () => {
		let app: Application;
		let notebooks: PositronNotebooks;

		before(async function () {
			app = this.app as Application;
			notebooks = app.workbench.positronNotebooks;
			await PositronPythonFixtures.SetupFixtures(app);
		});

		it('Python - Large notebook execution [C983592]', async function () {

			// huge timeout because this is a heavy test
			this.timeout(480_000);

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
				for (let j = 0; j < 100; j++) {
					await app.code.driver.page.mouse.wheel(0, 1);
					await app.code.wait(100);
				}

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
});
