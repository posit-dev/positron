/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Page } from '@playwright/test';
import { test } from '../../tests/_test.setup';
import { ACTIVE_CONSOLE_INSTANCE } from '../../pages/console';

const CONSOLE_INPUT = '.console-input';
import { capturePanel, captureRegion } from '../_helpers/screenshot-utils';
import { overrideWorkspaceName, prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';

// The panel's content area, excluding the CONSOLE/TERMINAL/... tab header,
// so the capture frames just the console plus the session list to its right.
const PANEL_CONTENT = '.part.panel > .content';
const WORKSPACE_NAME = 'positron-web';
// Fraction of the panel content height to keep for the python-objs capture, so the
// full 32-row mtcars table is cut off partway (like the published image) rather than
// making the screenshot very tall. Tune if the cutoff lands mid-row awkwardly.
const PYTHON_OBJS_CLIP_FRACTION = 0.5;

/**
 * Capture the panel content but trim the empty console area below the input
 * prompt, so the frame hugs the content the way the published image does
 * rather than including the full-height (mostly blank) console.
 */
async function capturePanelContentTrimmed(page: Page, filename: string): Promise<void> {
	const panelBox = await page.locator(PANEL_CONTENT).boundingBox();
	const inputBox = await page.locator(ACTIVE_CONSOLE_INSTANCE).first().locator(CONSOLE_INPUT).boundingBox();
	if (!panelBox || !inputBox) {
		throw new Error('Could not measure panel content / console input for trimmed capture');
	}
	const PADDING = 16;
	const height = Math.ceil(inputBox.y + inputBox.height - panelBox.y + PADDING);
	await captureRegion(page, filename, { x: panelBox.x, y: panelBox.y, width: panelBox.width, height });
}

test.use({
	suiteId: __filename,
});

test.describe('Release Screenshots - Reticulate', () => {
	test.beforeAll(async ({ settings }) => {
		await settings.set({
			'positron.reticulate.enabled': true,
			'kernelSupervisor.transport': 'tcp',
		}, { reload: true });
	});

	test.beforeEach(async ({ app, sessions }) => {
		await sessions.deleteAll();
	});

	test.afterEach(async ({ hotKeys }) => {
		await hotKeys.closeAllEditors();
	});

	/**
	 * Img Path: https://positron.posit.co/images/reticulate-interpreter.png
	 *
	 * Console after `reticulate::repl_python()` starts the Python (reticulate)
	 * session, with the session list showing R alongside Python (reticulate).
	 */
	test('Release Screenshot - reticulate-interpreter.png', async ({ app, page }) => {
		const { console, sessions, hotKeys } = app.workbench;
		await setScreenshotWindowSize(app, { width: 1200, height: 800 });

		// start an R session and launch the Python (reticulate) REPL
		await sessions.start('r');
		await console.pasteCodeToConsole('reticulate::repl_python()', true);
		await console.waitForReadyAndStarted('>>>');
		await sessions.expectAllSessionsToBeReady();

		// customize the layout
		await hotKeys.closePrimarySidebar();
		await console.maximizeConsole();
		await sessions.resizeSessionList({ x: -80 });

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'test-files', WORKSPACE_NAME);
		await capturePanelContentTrimmed(page, 'reticulate-interpreter.png');
	});

	/**
	 * Img Path: https://positron.posit.co/images/reticulate-interpreter-list.png
	 *
	 * The "Start New Session" quickpick listing the available interpreters,
	 * with Python (reticulate) suggested at the top.
	 */
	test('Release Screenshot - reticulate-interpreter-list.png', async ({ app, page }) => {
		const { sessions, quickInput } = app.workbench;
		await setScreenshotWindowSize(app);

		// open the "Start New Session" quickpick
		await sessions.openStartNewSessionQuickPick();
		await sessions.expectStartNewSessionMenuToBeVisible();

		// clear the leftover "New Session" filter text so every runtime is listed.
		await page.locator('.quick-input-box input').fill('');
		await expect(quickInput.widget.getByText('Python (reticulate)').first()).toBeVisible();

		// capture screenshot
		await prepareForScreenshot(app, page);
		await capturePanel(page, quickInput.widget, 'reticulate-interpreter-list.png');
	});

	/**
	 * Img Path: https://positron.posit.co/images/reticulate-python-objs.png
	 *
	 * Accessing an R object (the built-in mtcars data frame) from the Python
	 * (reticulate) session via `r.mtcars`.
	 */
	test('Release Screenshot - reticulate-python-objs.png', async ({ app, page }) => {
		const { console, sessions, hotKeys } = app.workbench;
		await setScreenshotWindowSize(app);

		// start an R session and launch the Python (reticulate) REPL
		await sessions.start('r');
		await console.pasteCodeToConsole('reticulate::repl_python()', true);
		await console.waitForReadyAndStarted('>>>');
		await sessions.expectAllSessionsToBeReady();

		// access an R data frame from Python (first reticulate conversion can be slow).
		// reticulate converts the R data.frame to a pandas DataFrame, which Positron
		// renders as an HTML table; wait on the last row (Volvo 142E). The console
		// auto-scrolls to the bottom, so we scroll back up before capturing below.
		await console.pasteCodeToConsole('r.mtcars', true);
		await expect(page.getByText('Volvo 142E')).toBeVisible({ timeout: 60000 });

		// customize the layout: just the panel, session list visible to the right
		await hotKeys.closePrimarySidebar();
		await console.maximizeConsole();
		await sessions.resizeSessionList({ x: -80 });

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'test-files', WORKSPACE_NAME);
		await page.locator(ACTIVE_CONSOLE_INSTANCE).first().evaluate(el => { el.scrollTop = 0; });
		const panelBox = await page.locator(PANEL_CONTENT).boundingBox();
		if (!panelBox) {
			throw new Error('Could not measure panel content for clipped capture');
		}
		await captureRegion(page, 'reticulate-python-objs.png', {
			x: panelBox.x,
			y: panelBox.y,
			width: panelBox.width,
			height: Math.round(panelBox.height * PYTHON_OBJS_CLIP_FRACTION),
		});
	});
});
