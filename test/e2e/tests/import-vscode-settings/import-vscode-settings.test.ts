/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Import VSCode Settings Feature
 *
 * This feature allows users to import their existing Visual Studio Code settings into Positron.
 *
 * Flow:
 * 1. On startup, Positron checks for existing VS Code settings and shows an import prompt if found
 * 2. Users can choose to import now, defer ("Later"), or permanently dismiss ("Don't Show Again")
 * 3. When importing:
 *    - If Positron already has settings, a diff view is shown to preview changes
 *    - If no Positron settings exist, a tab with the imported settings is opened
 *    - Users can accept or reject the changes
 *
 * Notes:
 * 1. The import can also be triggered manually via "Preferences: Import Settings..." command
 * 2. The import prompt can be reset via "Preferences: Reset Import Settings Prompt"
 */

import { Page } from '@playwright/test';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Import VSCode Settings', { tag: [tags.VSCODE_SETTINGS, tags.WIN] }, () => {
	test.beforeAll(async ({ vscodeUserSettings, positronUserSettings, runCommand }) => {
		await vscodeUserSettings.ensureExists();
		await positronUserSettings.ensureExists();
		await runCommand('workbench.action.reloadWindow');
	});

	test.beforeEach(async ({ sessions, hotKeys }) => {
		await sessions.expectNoStartUpMessaging(); // necessary to ensure that the import prompt is shown
		await hotKeys.closeAllEditors();
	});

	test.describe('Defer Import', () => {
		test('Verify import prompt behavior on "Later"', async ({ runCommand, app }) => {
			const { popups } = app.workbench;

			// select "Later" and verify that the prompt is no longer visible
			await popups.expectImportPromptToBeVisible();
			await popups.laterButton.click();
			await popups.expectImportPromptToBeVisible(false);

			// reload the window and verify that the prompt is shown again
			await runCommand('workbench.action.reloadWindow');
			await popups.expectImportPromptToBeVisible();
		});

		test('Verify import prompt behavior on "Don\'t Show Again"', async ({ sessions, app, runCommand, page }) => {
			const { popups } = app.workbench;

			// select "Don't Show Again" and verify that the prompt is no longer visible
			await popups.expectImportPromptToBeVisible();
			await popups.doNotShowAgainButton.click();
			await popups.expectImportPromptToBeVisible(false);

			// verify that prompt is not shown again
			await runCommand('workbench.action.reloadWindow');
			await sessions.expectNoStartUpMessaging();
			await page.waitForTimeout(3000); // extra time to ensure the prompt is not shown
			await popups.expectImportPromptToBeVisible(false);
		});
	});

	test.describe('Import with Positron settings', () => {
		test('Verify diff displays and rejected settings are not saved', async ({ app, page, runCommand }) => {
			const { popups } = app.workbench;

			// import settings and verify diff displays
			await runCommand('Preferences: Import Settings...', { exactMatch: true });
			await expectDiffToBeVisible(page);

			// reject the changes
			await popups.rejectButton.click();
			await expectDiffToBeVisible(page, false);
			await runCommand('Open User Settings (JSON)');
			await expect(page.getByText('"test": "positron-settings"')).toHaveCount(1);
		});

		test('Verify diff displays and accepted settings are saved', async ({ app, page, runCommand }) => {
			const { popups } = app.workbench;

			// import settings and verify diff displays
			await runCommand('Preferences: Import Settings...', { exactMatch: true });
			await expectDiffToBeVisible(page);

			// accept changes
			await popups.acceptButton.click();
			await expect(page.getByRole('tab', { name: 'settings.json' })).not.toBeVisible();
			await runCommand('Open User Settings (JSON)');
			await expect(page.getByText('Settings imported from Visual Studio Code')).toBeVisible();
		});
	});

	test.describe('Import without Positron settings', () => {
		test.beforeEach(async ({ positronUserSettings }) => {
			await positronUserSettings.delete();
		});

		test('Verify import import occurs and is clean without a diff', async ({ app, page, runCommand }) => {
			const { popups } = app.workbench;

			// import settings
			await runCommand('Preferences: Import Settings...', { exactMatch: true });
			await expect(page.getByRole('tab', { name: 'settings.json' })).toBeVisible();

			// accept changes
			await popups.acceptButton.click();
			await expect(page.getByRole('tab', { name: 'settings.json' })).not.toBeVisible();

			// verify settings imported
			await runCommand('Open User Settings (JSON)');
			await expect(page.getByText('Settings imported from Visual Studio Code')).toBeVisible();
		});
	});
});

async function expectDiffToBeVisible(page: Page, visible = true) {
	if (visible) {
		await expect(page.getByRole('tab', { name: 'settings.json' })).toBeVisible();
		// await expect(page.getByText('settings.json (in file) ↔ settings.json', { exact: true })).toBeVisible();
	} else {
		await page.waitForTimeout(3000); // waiting to avoid false positive
		await expect(page.getByRole('tab', { name: 'settings.json' })).not.toBeVisible();
		// await expect(page.getByText('settings.json (in file) ↔ settings.json', { exact: true })).not.toBeVisible();
	}
}
