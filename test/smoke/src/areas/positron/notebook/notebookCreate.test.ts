/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {

	describe('Notebooks', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Notebooks', () => {

			before(async function () {

				const app = this.app as Application;

				const pythonFixtures = new PositronPythonFixtures(app);
				await pythonFixtures.startPythonInterpreter();

			});

			it('Python - Basic notebook creation and execution', async function () {
				const app = this.app as Application;

				await app.workbench.quickaccess.runCommand('ipynb.newUntitledIpynb');

				await app.workbench.quickaccess.runCommand('notebook.cell.edit');

				// no type method in Microsoft base functionality
				await app.code.driver.getKeyboard().type('eval("8**2")');

				await app.workbench.quickaccess.runCommand('notebook.cell.execute');

				// basic CSS selection doesn't support frames (or nested frames)
				const notebookFrame = app.code.driver.getFrame('.webview').frameLocator('#active-frame');
				const outputLocator = notebookFrame.locator('.output-plaintext');
				const outputText = await outputLocator.textContent();

				expect(outputText).toBe('64');

			});
		});
	});

	describe('Notebooks', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('R Notebooks', () => {

			before(async function () {

				const app = this.app as Application;

				const rFixtures = new PositronRFixtures(app);
				await rFixtures.startRInterpreter();

			});

			it('R - Basic notebook creation and execution', async function () {
				const app = this.app as Application;

				await app.workbench.quickaccess.runCommand('ipynb.newUntitledIpynb');

				await app.workbench.quickaccess.runCommand('notebook.cell.edit');

				// no type method in Microsoft base functionality
				await app.code.driver.getKeyboard().type('eval(parse(text="8**2"))');

				await app.workbench.quickaccess.runCommand('notebook.cell.execute');

				// basic CSS selection doesn't support frames (or nested frames)
				const notebookFrame = app.code.driver.getFrame('.webview').frameLocator('#active-frame');
				const outputLocator = notebookFrame.locator('.output_container .output').nth(0);
				const outputText = await outputLocator.textContent();

				expect(outputText).toBe('[1] 64\n');

			});
		});


	});
}
