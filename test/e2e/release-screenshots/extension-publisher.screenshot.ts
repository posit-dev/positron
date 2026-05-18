/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test } from '../tests/_test.setup';
import { capturePanel, captureRegion } from './helpers/screenshot-utils';
import { annotate } from './helpers/annotate-utils';
import { hideToasts, setScreenshotWindowSize, waitForStableUI } from './helpers/layout-utils';

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
	 * Img Path: https://positron.posit.co/images/extension-publisher-trust.png
	 *
	 * The publisher-trust dialog appears the first time you install an extension
	 * from an unverified publisher. The test untrusts the publisher and uninstalls
	 * the extension first to ensure the dialog appears even on local re-runs.
	 */
	test.skip('Release Screenshot - extension-publisher-trust.png', async ({ app, page }) => {
		const { extensions } = app.workbench;

		// better-comments is published by an individual with no verified domain,
		// so installing it triggers the trust prompt on a clean profile.
		const id = 'aaron-bond.better-comments';

		// Make the test idempotent: untrust the publisher and uninstall the
		// extension before we click install, so the trust dialog actually appears.
		await extensions.untrustPublisher('aaron-bond');
		await extensions.uninstallExtensionIfInstalled(id);
		await extensions.clickInstallButton(id);

		const dialog = page.locator('.monaco-dialog-box');
		await expect(dialog).toBeVisible({ timeout: 30_000 });
		await expect(dialog.getByRole('button', { name: 'Trust Publisher & Install' })).toBeVisible();

		// capture screenshot
		await hideToasts(app);
		await waitForStableUI(page);
		await capturePanel(page, dialog, 'extension-publisher-trust.png');

		// Cancel out so we don't actually trust + install the extension.
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).not.toBeVisible();
	});

	/**
	 * Img Path: https://positron.posit.co/images/extension-verified-publisher.png
	 */
	test('Release Screenshot - extension-verified-publisher.png', async ({ app, page }) => {
		const { extensions } = app.workbench;

		// Air ships pre-installed and is published by Posit, so it
		// reliably has the verified-publisher badge.
		const id = 'posit.air-vscode';
		await extensions.openExtensionDetails(id);

		const header = page.locator('.extension-editor .header');
		await expect(header).toBeVisible();
		await expect(header.locator('.publisher')).toBeVisible();

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
		// Crop before the download count and rating — both are live numbers that
		// change between runs and would cause the screenshot to be flagged as new.
		const NARROW_WIDTH = 440;
		await captureRegion(page, 'extension-verified-publisher.png', {
			x: Math.floor(headerBox.x),
			y: Math.floor(headerBox.y),
			width: Math.min(NARROW_WIDTH, Math.ceil(headerBox.width)),
			height: Math.ceil(headerBox.height),
		});
	});


});
