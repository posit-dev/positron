/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Import VS Code Settings: with Positron settings', { tag: [tags.VSCODE_SETTINGS] }, () => {

	test.beforeEach(async ({ vscodeUserSettings, positronUserSettings, hotKeys }) => {
		await vscodeUserSettings.ensureExists();
		await positronUserSettings.ensureExists();
		await hotKeys.closeAllEditors();
	});

	test('Validate diff displays and when rejected settings are not saved', async ({ page, runCommand }) => {
		const importButton = page.locator('.notifications-toasts').getByRole('button', { name: 'Import' });
		const rejectButton = page.locator('.notifications-toasts').getByRole('button', { name: 'Reject' });

		// import settings
		await importButton.click();

		// verify diff displays
		await expect(page.getByRole('tab', { name: 'settings.json' })).toBeVisible();
		await expect(page.getByText('settings.json (in file) ↔ settings.json', { exact: true })).toBeVisible();
		await expect(page.getByText('"test": "positron-settings"')).toHaveCount(2);

		// reject the changes
		await rejectButton.click();
		await expect(page.getByRole('tab', { name: 'settings.json' })).not.toBeVisible();
		await expect(page.getByText('Settings imported from Visual Studio Code')).not.toBeVisible();
		await runCommand('Open User Settings (JSON)');
		await expect(page.getByText('"test": "positron-settings"')).toHaveCount(1);
	});

	test('Validate diff displays and when accepted settings are saved', async ({ page, runCommand }) => {
		const acceptButton = page.locator('.notifications-toasts').getByRole('button', { name: 'Accept' });

		// import settings
		await runCommand('Preferences: Import Settings...');

		// verify diff displays
		await expect(page.getByRole('tab', { name: 'settings.json' })).toBeVisible();
		await expect(page.getByText('settings.json (in file) ↔ settings.json', { exact: true })).toBeVisible();
		await expect(page.getByText('"test": "positron-settings"')).toHaveCount(2);

		// accept changes
		await acceptButton.click();
		await runCommand('Open User Settings (JSON)');
		await expect(page.getByText('Settings imported from Visual Studio Code')).toBeVisible();
	});
});
