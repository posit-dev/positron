/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';


export function setup(logger: Logger) {
	describe('Help', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Help', () => {

			before(async function () {

				const app = this.app as Application;

				const pythonFixtures = new PositronPythonFixtures(app);
				await pythonFixtures.startPythonInterpreter();

			});

			it('Python - Verifies basic help functionality', async function () {

				// TestRail
				const app = this.app as Application;
				await app.workbench.positronConsole.executeCode('Python', `?load`, '>>>');

				await expect(async () => {
					const helpFrame = await app.workbench.positronHelp.getHelpFrame(0);
					await expect(helpFrame.locator('body')).toContainText('Load code into the current frontend.');
				}).toPass();

			});
		});

		describe('R Help', () => {

			before(async function () {

				const app = this.app as Application;

				const rFixtures = new PositronRFixtures(app);
				await rFixtures.startRInterpreter();

			});

			it('R - Verifies basic help functionality', async function () {

				// TestRail
				const app = this.app as Application;
				await app.workbench.positronConsole.executeCode('R', `?load()`, '>');

				await expect(async () => {
					const helpFrame = await app.workbench.positronHelp.getHelpFrame(1);
					await expect(helpFrame.locator('body')).toContainText('Reload Saved Datasets');
				}).toPass();

			});
		});
	});
}
