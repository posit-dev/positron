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

	test('Verify diff displays and rejected settings are not saved', async ({ app, page, runCommand }) => {
		const { popups } = app.workbench;

		// import settings
		await popups.importButton.click();

		// verify diff displays
		await expect(page.getByRole('tab', { name: 'settings.json' })).toBeVisible();
		await expect(page.getByText('settings.json (in file) ↔ settings.json', { exact: true })).toBeVisible();
		await expect(page.getByText('"test": "positron-settings"')).toHaveCount(2);

		// reject the changes
		await popups.rejectButton.click();
		await expect(page.getByRole('tab', { name: 'settings.json' })).not.toBeVisible();
		await expect(page.getByText('Settings imported from Visual Studio Code')).not.toBeVisible();
		await runCommand('Open User Settings (JSON)');
		await expect(page.getByText('"test": "positron-settings"')).toHaveCount(1);
	});

	test('Verify diff displays and accepted settings are saved', async ({ app, page, runCommand }) => {
		const { popups } = app.workbench;

		// import settings
		await runCommand('Preferences: Import Settings...');

		// verify diff displays
		await expect(page.getByRole('tab', { name: 'settings.json' })).toBeVisible();
		await expect(page.getByText('settings.json (in file) ↔ settings.json', { exact: true })).toBeVisible();
		await expect(page.getByText('"test": "positron-settings"')).toHaveCount(2);

		// accept changes
		await popups.acceptButton.click();
		await expect(page.getByRole('tab', { name: 'settings.json' })).not.toBeVisible();
		await runCommand('Open User Settings (JSON)');
		await expect(page.getByText('Settings imported from Visual Studio Code')).toBeVisible();
	});
});
