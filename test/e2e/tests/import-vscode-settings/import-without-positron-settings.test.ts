/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Import VS Code Settings: no Positron settings', { tag: [tags.VSCODE_SETTINGS] }, () => {

	test.beforeEach(async ({ vscodeUserSettings, positronUserSettings }) => {
		await vscodeUserSettings.ensureExists();
		await positronUserSettings.delete();
	});

	test('Verify import import occurs and is clean without a diff', async ({ restartApp: app, page, runCommand }) => {
		const { popups } = app.workbench;

		await popups.importButton.click();
		await expect(page.getByRole('tab', { name: 'settings.json' })).toBeVisible();

		await popups.acceptButton.click();
		await expect(page.getByRole('tab', { name: 'settings.json' })).not.toBeVisible();
		await expect(page.getByText('settings.json (in file) ↔ settings.json', { exact: true })).not.toBeVisible();

		await runCommand('Open User Settings (JSON)');
		await expect(page.getByText('Settings imported from Visual Studio Code')).toBeVisible();
	});
});
