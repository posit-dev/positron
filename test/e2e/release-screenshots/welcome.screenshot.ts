/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { join } from 'path';
import { test } from '../tests/_test.setup';
import { capturePanel } from './helpers/screenshot-utils';
import { prepareForScreenshot, setScreenshotWindowSize } from './helpers/layout-utils';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

/**
 * Img Path: https://positron.posit.co/images/astropy.png
 */
test.describe('Release Screenshots - Welcome Page', () => {
	test('Standard Data View', async ({ app, page, openFolder, openFile, hotKeys, executeCode }) => {
		const { sessions, editors, plots, variables, quickaccess, layouts } =
			app.workbench;

		// open workspace
		await openFolder('qa-example-content/workspaces/astropy-testing');
		await page.waitForTimeout(3000); // allow time for window to close and re-open
		await page.locator('.monaco-workbench').waitFor({ state: 'visible' });
		await sessions.start(['python']);
		await sessions.expectAllSessionsToBeReady();

		// open python file that plots galactocentric ring orbits (just for editor context;
		// we execute the script statement by statement in the console below).
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

		// setup scroll position and expand variable for screenshot
		await hotKeys.closePrimarySidebar();
		await layouts.resizeAuxiliaryBar({ x: -500 });
		await layouts.resizePanel({ y: -150 });
		await quickaccess.runCommand('workbench.action.gotoLine', {
			keepOpen: true,
		});
		await page.keyboard.type(String(99));
		await page.keyboard.press('Enter');
		await variables.toggleVariable({
			variableName: 'gc_frame',
			action: 'expand',
		});

		// capture screenshot
		await prepareForScreenshot(app, page);
		await capturePanel(page.locator('.monaco-workbench'), 'astropy.png');
	});
});
