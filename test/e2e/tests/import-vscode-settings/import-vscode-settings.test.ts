/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page } from '@playwright/test';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Import VSCode Settings', { tag: [tags.VSCODE_SETTINGS] }, () => {
	test.beforeAll(async ({ vscodeUserSettings, positronUserSettings, runCommand }) => {
		await vscodeUserSettings.ensureExists();
		await positronUserSettings.ensureExists();
		await runCommand('workbench.action.reloadWindow');
	});

	test.beforeEach(async ({ sessions }) => {
		// necessary to ensure that the import prompt is shown
		await sessions.expectNoStartUpMessaging();
	});

	test.afterEach(async ({ hotKeys }) => {
		await hotKeys.closeAllEditors();
	});

	test.describe('Defer Import', () => {
		test('Verify import prompt behavior on "Later"', async ({ runCommand, app }) => {
			const { popups } = app.workbench;

			// Select "Later" and verify that the prompt is no longer visible
			await popups.expectImportPromptToBeVisible();
			await popups.laterButton.click();
			await popups.expectImportPromptToBeVisible(false);

			// Reload the window and verify that the prompt is shown again
			await runCommand('workbench.action.reloadWindow');
			await popups.expectImportPromptToBeVisible();
		});

		test('Verify import prompt behavior on "Don\'t Show Again"', async ({ sessions, app, runCommand }) => {
			const { popups } = app.workbench;

			// Select "Don't Show Again" and verify that the prompt is no longer visible
			await popups.expectImportPromptToBeVisible();
			await popups.doNotShowAgainButton.click();
			await popups.expectImportPromptToBeVisible(false);

			// Verify that prompt is not shown again
			await runCommand('workbench.action.reloadWindow');
			await sessions.expectNoStartUpMessaging();
			await popups.expectImportPromptToBeVisible(false);
		});
	});

	test.describe('Import with Positron settings', () => {
		test('Verify diff displays and rejected settings are not saved', async ({ app, page, runCommand, sessions }) => {
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
		await expect(page.getByText('settings.json (in file) ↔ settings.json', { exact: true })).toBeVisible();
	} else {
		await expect(page.getByRole('tab', { name: 'settings.json' })).not.toBeVisible();
		await expect(page.getByText('settings.json (in file) ↔ settings.json', { exact: true })).not.toBeVisible();
	}
}
