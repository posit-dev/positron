/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Plots: R locator()', {
	tag: [tags.PLOTS, tags.ARK]
}, () => {

	// The console stays busy while locator() waits, so do not wait for the prompt.
	const run = { waitForReady: false, maximizeConsole: false };

	test.afterEach(async function ({ app, hotKeys }) {
		await expect(async () => {
			await hotKeys.clearPlots();
			await app.workbench.plots.waitForNoPlots({ timeout: 3000 });
		}).toPass({ timeout: 15000 });
	});

	test('R - locator returns the clicked point', async function ({ app, r }) {
		const { console, plots } = app.workbench;

		await console.executeCode('R', 'plot(1:10); p <- locator(1)', run);
		await plots.waitForCurrentPlot();
		await plots.expectLocatorActive(true);
		await plots.clickPlotAt(0.5, 0.5);
		await plots.expectLocatorActive(false);
		await console.waitForReady('>');

		// The image center is near the data center; margins shift it slightly.
		await console.executeCode('R', 'cat(paste0("inrange-click:", p$x > 3 && p$x < 8 && p$y > 3 && p$y < 8))', { maximizeConsole: false });
		await console.waitForConsoleContents('inrange-click:TRUE');
	});

	test('R - Finish ends locator', async function ({ app, r }) {
		const { console, plots } = app.workbench;

		await console.executeCode('R', 'plot(1:10); p <- locator()', run);
		await plots.waitForCurrentPlot();
		await plots.expectLocatorActive(true);
		await plots.clickPlotAt(0.5, 0.5);
		// R draws nothing until the call returns, so the plot marks the click itself.
		await plots.expectLocatorMarkers(1);
		await plots.finishLocator();
		await plots.expectLocatorActive(false);
		await plots.expectLocatorMarkers(0);
		await console.waitForReady('>');

		await console.executeCode('R', 'cat(sprintf("npoints-finish:%d", length(p$x)))', { maximizeConsole: false });
		await console.waitForConsoleContents('npoints-finish:1');
	});

	test('R - Esc ends locator', async function ({ app, r, page }) {
		const { console, plots } = app.workbench;

		await console.executeCode('R', 'plot(1:10); p <- locator()', run);
		await plots.waitForCurrentPlot();
		await plots.expectLocatorActive(true);
		// The click answers this request. Wait for the next request, which gives the focus back
		// to the plot, so Escape reaches the locator.
		await plots.clickPlotAt(0.5, 0.5);
		await plots.expectLocatorFocused();
		await page.keyboard.press('Escape');
		await plots.expectLocatorActive(false);
		await console.waitForReady('>');

		await console.executeCode('R', 'cat(sprintf("npoints-esc:%d", length(p$x)))', { maximizeConsole: false });
		await console.waitForConsoleContents('npoints-esc:1');
	});

	test('R - interrupt ends locator', async function ({ app, r }) {
		const { console, plots } = app.workbench;

		// Braces make one top-level expression. After an interrupt, Ark still runs the
		// remaining top-level expressions of the same input, so a separate cat() would run.
		await console.executeCode('R', 'plot(1:10); { locator(); cat(paste0("after-", "locator")) }', run);
		await plots.waitForCurrentPlot();
		await plots.expectLocatorActive(true);
		await console.interruptExecution();
		await plots.expectLocatorActive(false);
		await console.waitForReady('>');
		await console.waitForConsoleContents('after-locator', { expectedCount: 0 });

		// A new locator() call must work after the interrupt.
		await console.executeCode('R', 'locator(1)', run);
		await plots.expectLocatorActive(true);
		await plots.finishLocator();
		await plots.expectLocatorActive(false);
	});
});
