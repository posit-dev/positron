/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test } from '../../tests/_test.setup';
import { capturePanelHires, captureRegion } from '../_helpers/screenshot-utils';
import { annotate, clearAnnotations } from '../_helpers/annotate-utils';
import { hideToasts, setScreenshotWindowSize, waitForStableUI } from '../_helpers/layout-utils';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

// Annotations are appended to the page <body> and persist across tests in the
// same suite. Clear them so the next test's screenshot starts unannotated.
test.afterEach(async ({ page }) => {
	await clearAnnotations(page);
});

test.describe('Release Screenshots - Top Action Bar', () => {
	/**
	 * Img Path: https://positron.posit.co/images/top-action-bar.png
	 */
	test.skip('Release Screenshot - top-action-bar.png', async ({ app, page }) => {
		const topBar = page.locator('.top-action-bar-container');
		await expect(topBar).toBeVisible();

		// Override the displayed folder name so the docs screenshot reads
		// "my-project" rather than "qa-example-content"
		await page.evaluate(() => {
			const el = document.querySelector('#top-action-bar-current-working-folder');
			if (el) { el.textContent = 'my-project'; }
		});

		await hideToasts(app);
		await annotate(page, [
			{ selector: '.top-action-bar-container [aria-label="New"]', label: 'New File / Folder', color: '#22c55e', labelPosition: 'above-left' },
			{ selector: '.top-action-bar-container [aria-label="Open"]', label: 'Open File / Folder', color: '#0d9488', labelPosition: 'below-center' },
			{ selector: ['.top-action-bar-container [aria-label="Go Back"]', '.top-action-bar-container [aria-label="Go Forward"]'], label: 'Backward / Forward', color: '#7c3aed', labelPosition: 'above-center' },
			{ selector: '.top-action-bar-command-center', label: 'Command Center', color: '#ca8a04', labelPosition: 'above-center' },
			{ selector: '.top-action-bar-session-manager-face', label: 'Interpreter Selector', color: '#ef4444', labelPosition: 'below-center' },
			{ selector: '.top-action-bar-custom-folder-menu', label: 'Folder Selector', color: '#ea580c', labelPosition: 'above-center' },
		]);
		await waitForStableUI(page);

		// Crop to the top of the window: top action bar plus space for the
		// above/below labels. Width = full viewport.
		const topBarBox = await topBar.boundingBox();
		if (!topBarBox) {
			throw new Error('Could not measure top action bar bounding box');
		}
		const LABEL_HEIGHT = 32; // badge + padding
		await captureRegion(page, 'top-action-bar.png', {
			x: 0,
			y: 0,
			width: 1920,
			height: Math.ceil(topBarBox.y + topBarBox.height + LABEL_HEIGHT),
		});
	});

	/**
	 * Img Path: https://positron.posit.co/images/action-bar-information.png
	 */
	test('Release Screenshot - action-bar-information.png', async ({ app, page }) => {
		const folderMenu = page.locator('.top-action-bar-custom-folder-menu');
		await expect(folderMenu).toBeVisible();

		// Override the displayed folder name so the docs screenshot reads "my-project".
		await page.evaluate(() => {
			const el = document.querySelector('#top-action-bar-current-working-folder');
			if (el) { el.textContent = 'my-project'; }
		});

		// capture screenshot (at 2x so the docs have a crisp image to scale)
		await hideToasts(app);
		await waitForStableUI(page);
		await capturePanelHires(page, folderMenu, 'action-bar-information.png', 2);
	});
});
