/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
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
	test('Standard Data View', async ({ app, page, openFolder, openFile, hotKeys }) => {
		const { sessions, editor, editors, plots, variables, quickaccess } =
			app.workbench;

		// open workspace
		await openFolder('qa-example-content/workspaces/astropy-testing');
		await page.waitForTimeout(3000); // allow time for window to close and re-open
		await page.locator('.monaco-workbench').waitFor({ state: 'visible' });
		await sessions.start(['python']);
		await sessions.expectAllSessionsToBeReady();

		// open python file that plots galactocentric ring orbits
		await openFile(
			join('workspaces', 'astropy-testing', 'plot_galactocentric_frame.py'),
		);
		await editors.waitForActiveTab('plot_galactocentric_frame.py');

		// run the file and wait for the plot
		await editor.playButton.click();
		await plots.waitForCurrentPlot();

		// setup scroll position and expand variable for screenshot
		await hotKeys.closePrimarySidebar();
		await quickaccess.runCommand('workbench.action.gotoLine', {
			keepOpen: true,
		});
		await page.keyboard.type(String(88));
		await page.keyboard.press('Enter');
		await variables.toggleVariable({
			variableName: 'gc_frame',
			action: 'expand',
		});

		// capture screenshot
		await prepareForScreenshot(app, page);
		await captureFullWindow(page, 'astropy.png');
	});
});
