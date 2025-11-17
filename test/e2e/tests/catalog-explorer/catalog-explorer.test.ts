/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

const workspace = process.env.DATABRICKS_WORKSPACE || 'workspace';
const pat = process.env.DATABRICKS_PAT || 'dummypat';

test.describe('Catalog Explorer', {
	tag: [tags.CATALOG_EXPLORER, tags.WEB, tags.WIN],
}, () => {
	test.beforeAll(async function ({ app, settings }) {

		await settings.set({
			'catalogExplorer.enabled': true
		});

		await app.restart();
	});

	test('Verify Basic Databricks Catalog Explorer functionality', async function ({ app, python }) {

		await app.code.driver.page.getByRole('button', { name: 'Catalog Explorer Section' }).click();

		await app.code.driver.page.getByText('Configure a Catalog Provider').click();

		await app.workbench.quickInput.waitForQuickInputOpened();
		await app.workbench.quickInput.type('Databricks');
		await app.workbench.quickInput.selectQuickInputElement(0, true);

		await app.workbench.quickInput.type(workspace);
		await app.code.driver.page.keyboard.press('Enter');
		await app.workbench.quickInput.type(pat);
		await app.code.driver.page.keyboard.press('Enter');

		await expect(app.code.driver.page.locator('.label-name').filter({ hasText: 'main' })).toBeVisible();
		await expect(app.code.driver.page.locator('.label-name').filter({ hasText: 'samples' })).toBeVisible();
		await expect(app.code.driver.page.locator('.label-name').filter({ hasText: 'system' })).toBeVisible();
		await expect(app.code.driver.page.locator('.label-name').filter({ hasText: 'workshops' })).toBeVisible();

		// cannot see dialog that doubles checks if removal is wanted in e2e tests
		// await app.code.driver.page.getByText(workspace.replace('https://','')).hover();
		// await app.code.driver.page.locator('.action-label[aria-label*="Remove Catalog Provider"]').click();

	});
});
