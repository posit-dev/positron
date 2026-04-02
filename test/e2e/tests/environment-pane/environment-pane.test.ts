/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Environment Pane', {
	tag: [tags.WEB, tags.WIN, tags.PACKAGES_PANE]
}, () => {

	const getPackagesButton = (page: any) => page.locator('a.action-label.codicon-package');

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'positron.environments.enable': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ page }) {
		await getPackagesButton(page).click();
	});

	async function verifyPackagesList(page: any, expectedVersion: string) {
		// Click on the Packages button in the environment pane
		await getPackagesButton(page).click();

		// Verify the packages list is displayed
		const packagesContainer = page.locator('.positron-packages-list');
		await expect(packagesContainer).toBeVisible();

		// Verify button contains the expected version
		const versionButton = packagesContainer.locator('.action-bar-region-left button').first();
		await expect(versionButton).toBeVisible();
		await expect(versionButton).toContainText(expectedVersion);

		// Verify package list items are present
		const packageItems = packagesContainer.locator('.packages-list-item-name');
		await expect(packageItems.first()).toBeVisible();
		const itemCount = await packageItems.count();
		expect(itemCount).toBeGreaterThan(0);
	}

	test('Python - Click packages button', async function ({ page, python: _python }) {
		await verifyPackagesList(page, process.env.POSITRON_PY_VER_SEL!);
	});

	test('R - Click packages button', async function ({ page, r: _r }) {
		await verifyPackagesList(page, process.env.POSITRON_R_VER_SEL!);
	});
});
