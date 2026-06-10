/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test } from '../../tests/_test.setup';
import { capturePanel } from '../_helpers/screenshot-utils';
import { prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

/**
 * Img Path: https://positron.posit.co/images/positron-path.png
 */
test.describe('Release Screenshots - Launch Positron', () => {
	test('Release Screenshot - positron-path.png', async ({ app, page, hotKeys }) => {
		const { quickInput } = app.workbench;

		// open the command palette and search for the positron path command
		await hotKeys.openCommandPalette();
		await page.keyboard.type('positron command path');

		// ensure the command is visible in the palette
		await expect(quickInput.widget).toBeVisible();
		await expect(
			quickInput.widget.getByText(`Shell Command: Install 'positron' command in PATH`),
		).toBeVisible();

		// capture screenshot
		await prepareForScreenshot(app, page);
		await capturePanel(page, quickInput.widget, 'positron-path.png');
	});
});
