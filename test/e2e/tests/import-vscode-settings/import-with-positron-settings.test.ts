/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { vsCodeSettings } from '../../pages/utils/userSettings/vscodeSettingsManager';
import { createPositronSettingsManager } from '../../infra/index.js';
import { UserSettingsFileManager } from '../../pages/utils/userSettingsFileManager.js';

test.use({
	suiteId: __filename
});

test.describe('Import VS Code Settings: with Positron settings', { tag: [tags.VSCODE_SETTINGS] }, () => {
	let positronSettingsManager: UserSettingsFileManager;

	test.beforeEach(async ({ userDataDir }) => {
		await vsCodeSettings.backupIfExists();
		await vsCodeSettings.ensureExists();

		positronSettingsManager = createPositronSettingsManager(userDataDir);
		await positronSettingsManager.backupIfExists();
		await positronSettingsManager.ensureExists();
	});

	test.afterEach(async () => {
		await vsCodeSettings.restoreFromBackup();
		await positronSettingsManager.restoreFromBackup();
	});

	test('Verify import occurs and shows diff if settings already exist', async ({ page, runCommand }) => {
		const importButton = page.locator('.notifications-toasts').getByRole('button', { name: 'Import' });
		const acceptButton = page.locator('.notifications-toasts').getByRole('button', { name: 'Accept' });

		await importButton.click();
		await expect(page.getByRole('tab', { name: 'settings.json' })).toBeVisible();
		await expect(page.getByText('settings.json (in file) ↔ settings.json', { exact: true })).toBeVisible();
		await expect(page.getByText('"test": "positron-settings"')).toHaveCount(2);

		await acceptButton.click();
		await expect(page.getByRole('tab', { name: 'settings.json' })).not.toBeVisible();

		await runCommand('Open User Settings (JSON)');
		await expect(page.getByText('Settings imported from Visual Studio Code')).toBeVisible();
	});
});


// test('rejecting diff closes without saving', async ({ page }) => {
// 	await page.click('button:has-text("Import")');
// 	await page.click('button:has-text("Reject")');

// 	await expect(page.locator('.monaco-diff-editor')).toBeHidden();
// 	// Optionally check no changes were saved
// });

// test('saving the diff editor dismisses notification', async ({ page }) => {
// 	await page.click('button:has-text("Import")');

// 	// Trigger save via keyboard shortcut or button
// 	await page.keyboard.press('Meta+S'); // or Ctrl+S on Windows

// 	const notification = page.locator('.monaco-workbench .notification-list');
// 	await expect(notification).not.toBeVisible();
// });
