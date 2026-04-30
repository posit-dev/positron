/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test } from '../tests/_test.setup';
import { capturePanel } from './helpers/screenshot-utils';
import { prepareForScreenshot } from './helpers/layout-utils';

test.use({
	suiteId: __filename,
});

test.describe('Release screenshots - Launch Positron', () => {
	test('positron path command palette', async ({ app, page, hotKeys }) => {
		// Reproduces the "positron path" command-palette closeup at
		// https://positron.posit.co/launch-positron-from-terminal.html.
		// The Windows installer screenshot on that same page is OS-level and
		// out of scope for this pipeline (manual).
		await hotKeys.openCommandPalette();
		await page.keyboard.type('positron path');

		const palette = page.locator('.quick-input-widget');
		await expect(palette).toBeVisible();
		await expect(palette.getByText(`Shell Command: Install 'positron' command in PATH`)).toBeVisible();

		await prepareForScreenshot(app, page);
		await capturePanel(palette, 'positron-path.png');
	});
});
