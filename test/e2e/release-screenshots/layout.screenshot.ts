/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { prepareForScreenshot, setScreenshotWindowSize } from './helpers/layout-utils';
import { annotate } from './helpers/annotate-utils';
import { join } from 'path';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

/**
 * Img Path: https://positron.posit.co/images/user-interface-for-rstudio-migration.jpeg
 */
test.describe('Release Screenshots - Layouts', () => {
	test('Annotated Layout Overview', async ({ app, page, openFolder, openFile }) => {
		const { layouts, sessions, editor, plots } = app.workbench;

		// Open the astropy workspace so the venv with matplotlib/astropy is picked up,
		// then run the plot script so Variables and Plots populate the secondary sidebar.
		await openFolder('qa-example-content/workspaces/astropy-testing');
		await page.waitForTimeout(3000);
		await page.locator('.monaco-workbench').waitFor({ state: 'visible' });
		await sessions.start(['python']);
		await sessions.expectAllSessionsToBeReady();

		await openFile(
			join('workspaces', 'astropy-testing', 'plot_galactocentric_frame.py'),
		);
		await editor.playButton.click();
		await plots.waitForCurrentPlot({ timeout: 45_000 });

		await layouts.resizeAuxiliaryBar({ x: -200 });
		await prepareForScreenshot(app, page);
		await annotate(page, [
			{ selector: '.activitybar', label: 'Activity bar', color: '#22c55e' },
			{
				selector: '.part.sidebar',
				label: 'Primary side bar',
				color: '#ca8a04',
				labelPosition: 'top-center',
			},
			{ selector: '.part.editor', label: 'Editor', color: '#7c3aed' },
			{
				selector: '.part.auxiliarybar',
				label: 'Secondary side bar',
				color: '#ea580c',
			},
			{ selector: '.part.panel', label: 'Panel', color: '#0d9488' },
		]);
		await captureFullWindow(page, 'user-interface-for-rstudio-migration.png');
	});
});
