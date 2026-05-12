/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { join } from 'path';
import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { prepareForScreenshot, setScreenshotWindowSize } from './helpers/layout-utils';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	// Welcome hero shot reads better at a smaller viewport — text and chrome
	// look proportionally larger when the docs image is rendered at fixed width.
	await setScreenshotWindowSize(app, { width: 1280, height: 800 });
});

/**
 * Img Path: https://positron.posit.co/images/astropy.png
 */
test.describe('Release Screenshots - Welcome Page', () => {
	test('Release Screenshot - astropy.png', async ({ app, page, openFolder, openFile, hotKeys, executeCode }) => {
		const { sessions, editors, plots, variables, quickaccess, layouts } =
			app.workbench;

		// open workspace
		await openFolder('qa-example-content/workspaces/astropy-testing');
		await page.waitForTimeout(3000); // allow time for window to close and re-open
		await page.locator('.monaco-workbench').waitFor({ state: 'visible' });

		// openFolder re-creates the Electron window, re-apply viewport settings.
		await setScreenshotWindowSize(app);

		// start session and open python file that plots galactocentric ring orbits
		await sessions.start(['python']);
		await sessions.expectAllSessionsToBeReady();
		const scriptRel = join('workspaces', 'astropy-testing', 'plot_galactocentric_frame.py');
		await openFile(scriptRel);
		await editors.waitForActiveTab('plot_galactocentric_frame.py');

		// Execute the script statement by statement in the console rather than
		// using the run-file (%run) play button. Splitting on blank lines keeps
		// each top-level block (imports, function def, computation, plot) as
		// separate console submissions.
		const scriptContent = readFileSync(
			join(app.workspacePathOrFolder, scriptRel),
			'utf-8',
		);
		const blocks = scriptContent.split(/\n\n+/).filter((b) => b.trim());
		for (const block of blocks) {
			await executeCode('Python', block, { maximizeConsole: false });
		}
		await plots.waitForCurrentPlot({ timeout: 45_000 });

		// setup scroll position and adjust layout
		await hotKeys.closePrimarySidebar();
		await plots.alterPlotArea(0, -75);
		await layouts.resizeAuxiliaryBar({ x: -420 });
		await layouts.resizePanel({ y: -130 });
		await quickaccess.runCommand('workbench.action.gotoLine', {
			keepOpen: true,
		});
		await page.keyboard.type(String(96));
		await page.keyboard.press('Enter');
		await variables.toggleVariable({
			variableName: 'gc_frame',
			action: 'expand',
		});
		await variables.scroll({ y: 150 });

		// capture screenshot
		await prepareForScreenshot(app, page);
		await captureFullWindow(page, 'astropy.png');
	});
});
