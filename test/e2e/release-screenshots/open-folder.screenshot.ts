/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { prepareForScreenshot, reapplyCdpViewport, setScreenshotWindowSize } from './helpers/layout-utils';
import { annotate, clearAnnotations } from './helpers/annotate-utils';

const ANNOTATION_COLOR = '#ea580c';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app, { width: 1280, height: 800 });
});

test.afterEach(async ({ page, hotKeys }) => {
	await page.keyboard.press('Escape');
	await clearAnnotations(page);
	await hotKeys.closeAllEditors();
});

test.describe('Release Screenshots - Open Folder', () => {
	/**
	 * Img Path: https://positron.posit.co/images/open-folder.png
	 *
	 * Welcome page (no folder open) with the top-right Folder Selector
	 * dropdown menu expanded, highlighting all the "open a folder" entry
	 * points: top-left Open button, welcome-page Open section, and the
	 * top-right folder dropdown + its menu.
	 */
	test('Release Screenshot - open-folder.png', async ({ app, page, hotKeys, r }) => {
		const { sessions, quickaccess } = app.workbench;
		await sessions.expectAllSessionsToBeReady();

		// Close the current folder so the no-folder Welcome page renders.
		// This reloads the workbench, so we re-apply the CDP viewport after.
		await quickaccess.runCommand('workbench.action.closeFolder');
		await page.waitForTimeout(3000);
		await page.locator('.monaco-workbench').waitFor({ state: 'visible' });
		await reapplyCdpViewport(app, { width: 1280, height: 800 });

		// Open the Welcome / Walkthrough editor explicitly (Positron's getting-
		// started page hosts the "Start" and "Open" sections shown in the docs ref).
		await quickaccess.runCommand('workbench.action.openWalkthrough');
		await expect(page.locator('.positron-welcome-page-start').first()).toBeVisible({ timeout: 15000 });

		// Click the top-right Folder Selector dropdown to reveal the menu.
		await page.locator('.top-action-bar-custom-folder-menu').click();
		const menu = page.locator('.positron-modal-popup');
		await expect(menu).toBeVisible();

		// capture screenshot
		await prepareForScreenshot(app, page);
		await annotate(page, [
			{ selector: '.top-action-bar-custom-folder-menu', label: '', color: ANNOTATION_COLOR, padding: 3, borderWidth: 3 },
			{ selector: '.positron-welcome-page-start', label: '', color: ANNOTATION_COLOR, padding: 6, borderWidth: 3 },
			{ selector: '.positron-modal-popup', label: '', color: ANNOTATION_COLOR, padding: 3, borderWidth: 3 },
		]);
		await hotKeys.closePrimarySidebar();
		await captureFullWindow(page, 'open-folder.png');
	});
});
