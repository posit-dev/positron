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

test.describe('Import VS Code Settings: no Positron settings', { tag: [tags.VSCODE_SETTINGS] }, () => {
	let positronSettings: UserSettingsFileManager;

	test.beforeEach(async ({ userDataDir }) => {
		await vsCodeSettings.backupIfExists();
		await vsCodeSettings.ensureExists();

		positronSettings = createPositronSettingsManager(userDataDir);
		await positronSettings.backupThenDelete();
	});

	test.afterEach(async () => {
		await vsCodeSettings.restoreFromBackup();
		await positronSettings.restoreFromBackup();
	});

	test('Verify import import occurs and is clean without a diff', async ({ page, runCommand }) => {
		const importButton = page.locator('.notifications-toasts').getByRole('button', { name: 'Import' });
		const acceptButton = page.locator('.notifications-toasts').getByRole('button', { name: 'Accept' });

		await importButton.click();
		await expect(page.getByRole('tab', { name: 'settings.json' })).toBeVisible();

		await acceptButton.click();
		await expect(page.getByRole('tab', { name: 'settings.json' })).not.toBeVisible();
		await expect(page.getByText('settings.json (in file) ↔ settings.json', { exact: true })).not.toBeVisible();

		await runCommand('Open User Settings (JSON)');
		await expect(page.getByText('Settings imported from Visual Studio Code')).toBeVisible();
	});
});
