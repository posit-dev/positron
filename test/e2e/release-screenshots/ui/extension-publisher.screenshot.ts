/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test } from '../../tests/_test.setup';
import { captureRegion } from '../_helpers/screenshot-utils';
import { annotate } from '../_helpers/annotate-utils';
import { hideToasts, setScreenshotWindowSize, waitForStableUI } from '../_helpers/layout-utils';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

test.afterEach(async ({ app }) => {
	await app.workbench.hotKeys.closeAllEditors();
});

test.describe('Release Screenshots - Extension Publisher', () => {

	/**
	 * Img Path: https://positron.posit.co/images/extension-verified-publisher.png
	 */
	test('Release Screenshot - extension-verified-publisher.png', async ({ app, page }) => {
		const { extensions } = app.workbench;

		// Air is published by Posit, so it reliably has the verified-publisher badge.
		const id = 'posit.air-vscode';
		await extensions.openExtensionDetails(id);

		const header = page.locator('.extension-editor .header');
		await expect(header).toBeVisible();
		await expect(header.locator('.publisher')).toBeVisible();

		// Ensure the extension is installed so the verified-publisher badge is visible.
		await extensions.installFromEditorIfNotInstalled();

		await hideToasts(app);

		// Draw an orange rectangle around the verified-publisher widget.
		await annotate(page, [
			{ selector: '.extension-editor .publisher', label: '', color: '#ea580c', padding: 6 },
		]);
		await waitForStableUI(page);

		// Crop horizontally and capture screenshot
		const headerBox = await header.boundingBox();
		if (!headerBox) {
			throw new Error('Could not measure extension header bounding box');
		}
		const NARROW_WIDTH = 700;
		await captureRegion(page, 'extension-verified-publisher.png', {
			x: Math.floor(headerBox.x),
			y: Math.floor(headerBox.y),
			width: Math.min(NARROW_WIDTH, Math.ceil(headerBox.width)),
			height: Math.ceil(headerBox.height),
		});
	});


});
