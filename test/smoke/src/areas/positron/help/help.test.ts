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

				// TestRail 633814
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

				// TestRail 633813
				const app = this.app as Application;
				await app.workbench.positronConsole.executeCode('R', `?load()`, '>');

				await expect(async () => {
					const helpFrame = await app.workbench.positronHelp.getHelpFrame(1);
					await expect(helpFrame.locator('body')).toContainText('Reload Saved Datasets');
				}).toPass();

			});
		});

		describe('Collapse behavior', () => {

			it.only('Verifies help panel can be opened when empty and also can be resized smaller and remember resize height', async function () {

				const app = this.app as Application;
				const positronHelp = app.workbench.positronHelp;
				// How close should our heights be? It's not totally clear why this isn't always
				// exact, but it's likely due to rounding errors or other factors. We'll allow
				// a small margin of error.
				const sizePrecision = 5;

				// app.code.workbench.reduceMotion
				// app.workbench.settingsEditor
				// Enter layout with help pane docked in session panel
				await app.workbench.quickaccess.runCommand('workbench.action.positronHelpPaneDocked');

				const helpContainerLocator = positronHelp.getHelpContainer();
				const helpPanelHeaderLocator = positronHelp.getHelpHeader();

				// Help panel starts collapsed thanks to the above command
				await expect(helpContainerLocator).not.toBeVisible();

				// Clicking the header opens it
				await helpPanelHeaderLocator.click();
				// Wait to allow the open animation to complete
				await app.code.wait(1000);

				await expect(helpContainerLocator).toBeVisible();
				// Get the height of the help panel
				const helpPanelHeight = (await helpContainerLocator.boundingBox())?.height ?? -1;
				// Make sure that an empty help panel actually expands to a visible size.
				expect(helpPanelHeight).toBeGreaterThan(100);

				// Now resize the help panel smaller than the pop-open size and make sure that
				// when we collapse and reopen it doesn't pop back to the full size again.

				// We'll make it roughly two thirds the size of the original height
				const resize_delta = helpPanelHeight / 3;
				await positronHelp.resizeHelpPanel({ y: resize_delta });

				// Verify that the height has changed by the expected amount
				const helpPanelHeightAfter = (await helpContainerLocator.boundingBox())?.height ?? -1;
				expect(helpPanelHeight - helpPanelHeightAfter - resize_delta).toBeLessThan(sizePrecision);

				// Now collapse the panel again
				await helpPanelHeaderLocator.click();
				await expect(helpContainerLocator).not.toBeVisible();

				// Reopen the panel
				await helpPanelHeaderLocator.click();
				await app.code.wait(1000);

				// Make sure that the panel is smaller than it was before after opening up.
				// Should be roughly the same size it was before we collapsed it. Allow for
				// small deviations due to rounding errors etc..
				const helpPanelHeightAfterReopen = (await helpContainerLocator.boundingBox())?.height ?? -1;
				expect(Math.abs(helpPanelHeightAfterReopen - helpPanelHeightAfter)).toBeLessThan(sizePrecision);
			});
		});
	});
}
