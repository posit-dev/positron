/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { prepareForScreenshot } from './helpers/layout-utils';

test.use({
	suiteId: __filename,
});

test.describe('Release screenshots - Welcome', () => {
	test('welcome page', async ({ app, page, openFolder, openFile, hotKeys, python }) => {
		// Reproduce the hero shot at https://positron.posit.co/: an open Python
		// file plotting Galactocentric ring orbits, with the resulting plot in
		// the Plots pane and the produced variables in the Variables pane.
		test.slow();

		await openFolder('qa-example-content/workspaces/astropy-testing');
		await app.workbench.console.waitForReady('>>>', 30000);

		await openFile(join('workspaces', 'astropy-testing', 'plot_galactocentric_frame.py'));
		await hotKeys.runFileInConsole();

		await app.workbench.plots.waitForCurrentStaticPlot();
		await app.workbench.variables.waitForVariableRow('gal_rings');

		await prepareForScreenshot(app, page);
		await captureFullWindow(page, 'welcome.png');
	});
});
