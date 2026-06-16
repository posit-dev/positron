/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { test } from '../../tests/_test.setup';
import { captureFullWindow } from '../_helpers/screenshot-utils';
import { prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';
import { annotate } from '../_helpers/annotate-utils';

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
	test.skip('Release Screenshot - user-interface-for-rstudio-migration.png', async ({ app, page, openFolder, openFile, executeCode }) => {
		const { layouts, sessions, plots } = app.workbench;

		// Clone positron-workshop into the test workspace so the explorer
		// shows a populated file tree matching the docs reference.
		const workshopDir = join(app.workspacePathOrFolder, 'positron-workshop');
		if (!existsSync(workshopDir)) {
			execSync(
				`git clone --depth=1 https://github.com/posit-dev/positron-workshop.git "${workshopDir}"`,
				{ stdio: 'inherit' },
			);
		}

		// Open the workshop folder so VS Code's workspace is positron-workshop.
		await openFolder('qa-example-content/positron-workshop');

		// Start a Python session and run a small script so Variables and Plots
		// populate the secondary sidebar.
		await sessions.start(['python']);
		await sessions.expectAllSessionsToBeReady();
		await executeCode('Python', [
			'import matplotlib.pyplot as plt',
			'import numpy as np',
			'import pandas as pd',
			'np.random.seed(0)',
			'species = np.repeat([\'Adelie\', \'Chinstrap\', \'Gentoo\'], 50)',
			'bill = np.concatenate([np.random.normal(39, 2, 50), np.random.normal(49, 3, 50), np.random.normal(47, 3, 50)])',
			'flipper = np.concatenate([np.random.normal(190, 6, 50), np.random.normal(196, 7, 50), np.random.normal(217, 6, 50)])',
			'penguins = pd.DataFrame({\'species\': species, \'bill_length_mm\': bill, \'flipper_length_mm\': flipper})',
			'fig, ax = plt.subplots(figsize=(7, 4))',
			'for sp in [\'Adelie\', \'Chinstrap\', \'Gentoo\']:\n\tgrp = penguins[penguins[\'species\'] == sp]\n\tax.scatter(grp[\'flipper_length_mm\'], grp[\'bill_length_mm\'], label=sp, alpha=0.7)',
			'ax.set_xlabel(\'Flipper length (mm)\')',
			'ax.set_ylabel(\'Bill length (mm)\')',
			'ax.legend(title=\'Penguin species\')',
			'ax.set_title(\'Flipper and bill length\')',
			'plt.show()',
		].join('\n'));
		await plots.waitForCurrentPlot({ timeout: 45_000 });

		// Open a few qmd files so the editor has multiple tabs.
		await openFile('positron-workshop/setup.qmd');
		await openFile('positron-workshop/raukr.qmd');
		await openFile('positron-workshop/modules/01-hello-positron.qmd');
		await openFile('positron-workshop/index.qmd');

		// resize, annotate, and capture full window screenshot
		await layouts.resizeAuxiliaryBar({ x: -400 });
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
