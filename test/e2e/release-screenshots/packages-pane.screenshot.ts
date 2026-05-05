/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { join } from 'path';
import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { hideToasts, setScreenshotWindowSize, waitForStableUI } from './helpers/layout-utils';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

/**
 * Img Path: https://positron.posit.co/images/packages-pane.png
 */
test.describe('Release Screenshots - Packages Pane', () => {
	test('Packages pane with filter submenu open', async ({ app, page, openFolder, openFile }) => {
		const { sessions, packages, editors } = app.workbench;

		// open workspace
		await openFolder('qa-example-content/workspaces/astropy-testing');
		await page.waitForTimeout(3000); // allow time for window to close and re-open
		await page.locator('.monaco-workbench').waitFor({ state: 'visible' });
		await sessions.start(['python']);
		await sessions.expectAllSessionsToBeReady();

		// open a python file so the editor pane has content for the screenshot
		await openFile(
			join('workspaces', 'astropy-testing', 'plot_galactocentric_frame.py'),
		);
		await editors.waitForActiveTab('plot_galactocentric_frame.py');

		// open the packages pane and wait for the list to populate
		await packages.clickPackagesButton();
		await expect(packages.packagesContainer).toBeVisible();
		await expect(
			packages.packagesContainer.locator('.packages-list-item-name').first(),
		).toBeVisible();

		// Hide toasts BEFORE opening the menu - the standard prepareForScreenshot
		// helper also calls unhoverAll(), which would move the mouse to 0,0 and
		// close the menu we are about to open.
		await hideToasts(app);

		// click the filter funnel to open the top-level Filter/Sort menu
		await page.locator('.positron-packages-list .filter-button').click();
		const topMenu = page
			.locator('.positron-modal-popup-container .custom-context-menu-items')
			.first();
		await expect(topMenu).toBeVisible();
		const filterSubmenuTrigger = topMenu.locator('.custom-context-menu-item', {
			has: page.locator('.title', { hasText: 'Filter' }),
		});
		await expect(filterSubmenuTrigger).toBeVisible();

		// hover Filter to reveal the nested submenu (All Packages / Outdated / Attached)
		await filterSubmenuTrigger.hover();
		const submenu = page
			.locator('.positron-modal-popup-container .custom-context-menu-items')
			.nth(1);
		await expect(submenu).toBeVisible();
		const outdatedItem = submenu.locator('.custom-context-menu-item', {
			has: page.locator('.title', { hasText: 'Outdated' }),
		});
		await expect(outdatedItem).toBeVisible();

		// hover Outdated so it shows the highlighted state in the reference image
		await outdatedItem.hover();

		// settle CSS transitions but skip unhoverAll - moving the mouse would close the menu
		await waitForStableUI(page);

		await captureFullWindow(page, 'packages-pane.png');
	});
});
