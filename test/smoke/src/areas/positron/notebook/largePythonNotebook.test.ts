/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { Application, PositronNotebooks, PositronPythonFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';
import { IElement } from '../../../../../automation/out/driver';

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

			this.timeout(90000);

			await app.workbench.positronQuickaccess.openDataFile(join(app.workspacePathOrFolder, 'workspaces', 'large_py_notebook', 'spotify.ipynb'));

			await notebooks.selectInterpreter('Python Environments', process.env.POSITRON_PY_VER_SEL!);

			await app.code.driver.page.getByText('Run All').click();

			const stopExecutionLocator = app.code.driver.page.locator('a').filter({ hasText: 'Stop Execution' });

			while (await stopExecutionLocator.isVisible()) {
				await app.code.wait(5000);
			}

			await app.workbench.quickaccess.runCommand('notebook.focusTop');
			//await app.workbench.quickaccess.runCommand('notebook.focusBottom');

			await app.code.driver.page.click('.notebook-overview-ruler-container');

			const allFigures: IElement[] = [];
			for (let i = 0; i < 20; i++) {

				await app.code.driver.page.mouse.move(0, i * 10);

				await app.code.driver.page.mouse.down();
				await app.code.driver.page.mouse.move(0, 10);
				await app.code.driver.page.mouse.up();

				await app.code.wait(1000);

				const figures = await app.code.getElements('.plot-container', false);

				if (figures!.length > 0) {
					allFigures.push(...figures!);
				}
			}

			console.log('debug');


		});
	});
});
