/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Help', { tag: [tags.HELP, tags.WEB] }, () => {

	test.beforeAll(async function ({ settings }) {
		// Enable reduced motion so we don't have to wait for animations of expanding
		// and collapsing the panel.
		await settings.set({ 'workbench.reduceMotion': 'on' }, { reload: 'web' });
	});

	test('Python - Verify Help landing page', { tag: [tags.WIN] }, async function ({ app }) {

		await app.workbench.layouts.enterLayout('fullSizedAuxBar');
		await app.workbench.help.openHelpPanel();

		const helpFrame = await app.workbench.help.getHelpWelcomePageFrame();
		const docLink = helpFrame.getByRole('link', { name: 'Positron Documentation' });
		await expect(docLink).toBeVisible();
		await expect(docLink).toHaveAttribute('href', 'https://positron.posit.co/');
		await app.workbench.layouts.enterLayout('stacked');
	});

	test('Python - Verify basic help functionality', { tag: [tags.WIN] }, async function ({ app, python }) {
		await app.workbench.console.executeCode('Python', `?load`);

		await expect(async () => {
			const helpFrame = await app.workbench.help.getHelpFrame(0);
			await expect(helpFrame.locator('body')).toContainText('Load code into the current frontend.');
		}).toPass();

	});

	test('R - Verify basic help functionality', { tag: [tags.WIN] }, async function ({ app, r }) {
		await app.workbench.console.executeCode('R', `?load()`);

		await expect(async () => {
			const helpFrame = await app.workbench.help.getHelpFrame(1);
			await expect(helpFrame.locator('body')).toContainText('Reload Saved Datasets');
		}).toPass();

	});

	test('Verify help panel opens when empty, can be resized smaller, and remembers size height', { tag: [tags.WIN] }, async function ({ app, logger }) {
		// Not running on windows as the size calculation is off for the resolution in CI
		const help = app.workbench.help;
		const helpContainerLocator = help.getHelpContainer();
		const helpPanelHeaderLocator = help.getHelpHeader();
		const getHelpHeight = async () => (await helpContainerLocator.boundingBox())?.height ?? -1;

		// How close should our heights be? It's not totally clear why this isn't always
		// exact, but it's likely due to rounding errors or other factors. We'll allow
		// a small margin of error.
		const sizePrecision = 5;

		// Enter layout with help pane docked in session panel
		await app.workbench.layouts.enterLayout('dockedHelp');

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
		await help.resizeHelpPanel({ y: resize_delta });

		// Verify that the height has changed by the expected amount
		const helpPanelHeightAfter = await getHelpHeight();
		expect(expectedHeightAfterResize - helpPanelHeightAfter)
			.toBeLessThan(sizePrecision);

		// Now collapse the panel again
		await helpPanelHeaderLocator.click();
		await expect(helpContainerLocator).not.toBeVisible();

		// Reopen the panel
		await helpPanelHeaderLocator.click();

		if (helpPanelHeightAfter <= 100) {
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
