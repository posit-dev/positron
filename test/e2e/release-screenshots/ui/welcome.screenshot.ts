/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { join } from 'path';
import { test } from '../../tests/_test.setup';
import { captureFullWindow } from '../_helpers/screenshot-utils';
import { overrideWorkspaceName, prepareForScreenshot, reapplyCdpViewport, setScreenshotWindowSize } from '../_helpers/layout-utils';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	// Smaller viewport so text/chrome read proportionally larger
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
		await openFolder('test-files/workspaces/astropy-testing');

		// openFolder re-creates the Electron window, dropping the per-page
		// CDP override. Re-apply only the override (don't call setSize a
		// second time — that has been observed to wedge worker teardown).
		await reapplyCdpViewport(app, { width: 1280, height: 800 });

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
		await plots.alterPlotArea(0, -55);
		await layouts.resizeAuxiliaryBar({ x: -300 });
		await layouts.resizePanel({ y: -100 });
		await quickaccess.runCommand('workbench.action.gotoLine', {
			keepOpen: true,
		});
		await page.keyboard.type('182');
		await page.keyboard.press('Enter');
		await variables.toggleVariable({
			variableName: 'gc_frame',
			action: 'expand',
		});
		// await variables.scroll({ y: 300 });

		// capture screenshot
		await prepareForScreenshot(app, page);
		// from === to is intentional: the title-bar / folder-picker should keep
		// reading "astropy-testing", but the console's current-working-dir label
		// needs the tilde-form rewrite so the temp workspace path doesn't leak.
		await overrideWorkspaceName(page, 'astropy-testing', 'astropy-testing');
		await captureFullWindow(page, 'astropy.png');
	});
});
