/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { Application, PositronNotebooks, PositronPythonFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';
import { expect } from '@playwright/test';


describe('Large Notebooks', () => {
	setupAndStartApp();

	describe('Large Python Notebook', () => {
		let app: Application;
		let notebooks: PositronNotebooks;

		before(async function () {
			app = this.app as Application;
			notebooks = app.workbench.positronNotebooks;
			await PositronPythonFixtures.SetupFixtures(app);
		});

		it('Python - Large notebook execution [C...]', async function () {

			this.timeout(160000);

			await app.workbench.positronQuickaccess.openDataFile(join(app.workspacePathOrFolder, 'workspaces', 'large_py_notebook', 'spotify.ipynb'));

			await notebooks.selectInterpreter('Python Environments', process.env.POSITRON_PY_VER_SEL!);

			await app.code.driver.page.getByText('Run All').click();

			const stopExecutionLocator = app.code.driver.page.locator('a').filter({ hasText: 'Stop Execution' });

			await expect(stopExecutionLocator).toBeVisible();
			await expect(stopExecutionLocator).not.toBeVisible({ timeout: 30000 });

			await app.workbench.quickaccess.runCommand('notebook.focusTop');

			await app.code.driver.page.locator('span').filter({ hasText: 'import pandas as pd' }).locator('span').first().click();

			const allFigures: any[] = [];
			const uniqueFigureParents = new Set<string>();

			for (let i = 0; i < 500; i++) {
				await app.code.driver.page.mouse.wheel(0, 1000);

				const figureLocator = app.workbench.positronNotebooks.frameLocator.locator('.plot-container');
				const figures = await figureLocator.all();

				if (figures!.length > 0) {
					for (const figure of figures!) {
						const figureParentLocator = figure.locator('..');
						const figureParent = await figureParentLocator.textContent();

						if (figureParent && !uniqueFigureParents.has(figureParent)) {
							uniqueFigureParents.add(figureParent);
							allFigures.push(figure);
						}
					}
				}
			}

			console.log('debug');


		});
	});
});
