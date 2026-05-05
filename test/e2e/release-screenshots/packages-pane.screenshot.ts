/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test } from '../tests/_test.setup';
import { captureRegion } from './helpers/screenshot-utils';
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
		await packages.expectPackagesListPopulated();

		// Hide toasts BEFORE opening the menu
		await hideToasts(app);

		// open the filter options menu, expand the Filter submenu, and highlight Outdated
		await packages.openFilterOptionsMenu();
		await packages.expandFilterOptionsSubmenu('Filter');
		await packages.hoverFilterOptionsSubmenuItem('Outdated');

		// settle CSS transitions but skip unhoverAll - moving the mouse would close the menu
		await waitForStableUI(page);

		// Crop to the activity bar + sidebar + dropdown fly-out + a slice of editor
		// for context, matching the framing of the original docs image.
		const submenuBox = await packages.filterOptionsSubmenu.boundingBox();
		if (!submenuBox) {
			throw new Error('Could not measure submenu bounding box');
		}
		const EDITOR_CONTEXT_PX = 350;
		const HEIGHT_PX = 600;
		await captureRegion(page, 'packages-pane.png', {
			x: 0,
			y: 0,
			width: Math.ceil(submenuBox.x + submenuBox.width + EDITOR_CONTEXT_PX),
			height: HEIGHT_PX,
		});
	});
});
