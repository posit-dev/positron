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

	test('Verify import prompt behavior on "Later"', async ({ app, runCommand }) => {
		const { popups } = app.workbench;

		await expect(popups.importButton).toBeVisible();
		await expect(popups.laterButton).toBeVisible();
		await expect(popups.doNotShowAgainButton).toBeVisible();

		// Click Later button and reload
		await popups.laterButton.click();
		await expect(popups.importButton).not.toBeVisible();
		await runCommand('workbench.action.reloadWindow');

		// Verify that prompt is shown again
		await expect(popups.importButton).toBeVisible();
		await expect(popups.laterButton).toBeVisible();
		await expect(popups.doNotShowAgainButton).toBeVisible();
	});

	test('Verify import prompt behavior on "Don\'t Show Again"', async ({ sessions, app, runCommand }) => {
		const { popups } = app.workbench;

		await expect(popups.importButton).toBeVisible();
		await expect(popups.laterButton).toBeVisible();
		await expect(popups.doNotShowAgainButton).toBeVisible();

		// Click Don't Show Again button and reload
		await popups.doNotShowAgainButton.click();
		await expect(popups.importButton).not.toBeVisible();
		await runCommand('workbench.action.reloadWindow');

		// Verify that prompt is not shown again
		await sessions.expectNoStartUpMessaging();
		await expect(popups.importButton).not.toBeVisible();
		await expect(popups.laterButton).not.toBeVisible();
		await expect(popups.doNotShowAgainButton).not.toBeVisible();
	});
});
