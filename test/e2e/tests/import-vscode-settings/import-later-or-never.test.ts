/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Import VSCode Settings: Defer', { tag: [tags.VSCODE_SETTINGS] }, () => {

	test.beforeEach(async ({ vscodeUserSettings }) => {
		await vscodeUserSettings.ensureExists();
	});

	test('Verify import prompt behavior on "Later"', async ({ page, runCommand }) => {
		const importButton = page.locator('.notifications-toasts').getByRole('button', { name: 'Import' });
		const laterButton = page.locator('.notifications-toasts').getByRole('button', { name: 'Later' });
		const doNotShowAgainButton = page.locator('.notifications-toasts').getByRole('button', { name: 'Don\'t Show Again' });

		await expect(importButton).toBeVisible();
		await expect(laterButton).toBeVisible();
		await expect(doNotShowAgainButton).toBeVisible();

		// Click Later button and reload
		await laterButton.click();
		await expect(importButton).not.toBeVisible();
		await runCommand('workbench.action.reloadWindow');

		// Verify that prompt is shown again
		await expect(importButton).toBeVisible();
		await expect(laterButton).toBeVisible();
		await expect(doNotShowAgainButton).toBeVisible();
	});

	test('Verify import prompt behavior on "Don\'t Show Again"', async ({ sessions, page, runCommand }) => {
		const importButton = page.locator('.notifications-toasts').getByRole('button', { name: 'Import' });
		const laterButton = page.locator('.notifications-toasts').getByRole('button', { name: 'Later' });
		const doNotShowAgainButton = page.locator('.notifications-toasts').getByRole('button', { name: 'Don\'t Show Again' });

		await expect(importButton).toBeVisible();
		await expect(laterButton).toBeVisible();
		await expect(doNotShowAgainButton).toBeVisible();

		// Click Don't Show Again button and reload
		await doNotShowAgainButton.click();
		await expect(importButton).not.toBeVisible();
		await runCommand('workbench.action.reloadWindow');

		// Verify that prompt is not shown again
		await sessions.expectNoStartUpMessaging();
		await expect(importButton).not.toBeVisible();
		await expect(laterButton).not.toBeVisible();
		await expect(doNotShowAgainButton).not.toBeVisible();
	});
});
