/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

/*
 * Help test cases
 */
export function setup(logger: Logger) {
	describe('Help', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Help', () => {

			before(async function () {

				await PositronPythonFixtures.SetupFixtures(this.app as Application);

			});

			it('Python - Verifies basic help functionality [C633814] #nightly', async function () {

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

				await PositronRFixtures.SetupFixtures(this.app as Application);

			});

			it('R - Verifies basic help functionality [C633813] #nightly', async function () {

				const app = this.app as Application;
				await app.workbench.positronConsole.executeCode('R', `?load()`, '>');

				await expect(async () => {
					const helpFrame = await app.workbench.positronHelp.getHelpFrame(1);
					await expect(helpFrame.locator('body')).toContainText('Reload Saved Datasets');
				}).toPass();

			});
		});

		describe('Collapse behavior', () => {

			it('Verifies help panel can be opened when empty and also can be resized smaller and remember resize height [C640934] #nightly', async function () {

				const app = this.app as Application;
				const positronHelp = app.workbench.positronHelp;
				const helpContainerLocator = positronHelp.getHelpContainer();
				const helpPanelHeaderLocator = positronHelp.getHelpHeader();
				const getHelpHeight = async () => (await helpContainerLocator.boundingBox())?.height ?? -1;

				// How close should our heights be? It's not totally clear why this isn't always
				// exact, but it's likely due to rounding errors or other factors. We'll allow
				// a small margin of error.
				const sizePrecision = 5;

				// Enable reduced motion so we don't have to wait for animations of expanding
				// and collapsing the panel.
				await app.workbench.settingsEditor.addUserSetting('workbench.reduceMotion', '"on"');

				// Enter layout with help pane docked in session panel
				await app.workbench.positronLayouts.enterLayout('dockedHelp');

				// Help panel starts collapsed thanks to the above command
				await expect(helpContainerLocator).not.toBeVisible();

				// Clicking the header opens it
				await helpPanelHeaderLocator.click();
				await expect(helpContainerLocator).toBeVisible();

				// Make sure that an empty help panel actually expands to a visible size.
				const helpPanelHeight = await getHelpHeight();
				expect(helpPanelHeight).toBeGreaterThan(100);

				// Now resize the help panel smaller than the pop-open size and make sure that
				// when we collapse and reopen it doesn't pop back to the full size again.

				// We'll make it roughly two thirds the size of the original height
				const resize_delta = helpPanelHeight / 3;
				const expectedHeightAfterResize = helpPanelHeight - resize_delta;
				await positronHelp.resizeHelpPanel({ y: resize_delta });

				// Verify that the height has changed by the expected amount
				const helpPanelHeightAfter = await getHelpHeight();
				expect(expectedHeightAfterResize - helpPanelHeightAfter)
					.toBeLessThan(sizePrecision);

				// Now collapse the panel again
				await helpPanelHeaderLocator.click();
				await expect(helpContainerLocator).not.toBeVisible();

				// Reopen the panel
				await helpPanelHeaderLocator.click();

				if (helpPanelHeightAfter < 100) {
					// When the panel is small enough, it will pop back to the full size.
					// This can happen if the window used for testing is too small.
					// In this case we want to end the test early because the behavior wont be as
					// expected.
					// TODO: Make sure window is a set size at start of test.
					logger.log('Window too small to test resize memory. Skipping end of help panel collapse test.');
					return;
				}
				// Make sure that the panel is smaller than it was before after opening up.
				// Should be roughly the same size it was before we collapsed it. Allow for
				// small deviations due to rounding errors etc..
				const helpPanelHeightAfterReopen = await getHelpHeight();
				expect(Math.abs(helpPanelHeightAfterReopen - helpPanelHeightAfter))
					.toBeLessThan(sizePrecision);
			});
		});
	});
}
