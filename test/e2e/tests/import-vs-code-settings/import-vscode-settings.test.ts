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

import { Locator } from '@playwright/test';
import { test, expect, tags } from '../_test.setup';
import { Application } from '../../infra/application.js';

test.use({
	suiteId: __filename
});

test.describe('Import VSCode Settings', { tag: [tags.VSCODE_SETTINGS, tags.WIN] }, () => {
	test.beforeAll(async ({ vsCodeSettings: vscodeUserSettings, settings: positronUserSettings }) => {
		await vscodeUserSettings.append({
			'test': 'vs-code-settings',
			'editor.fontSize': 12,
			'workbench.colorTheme': 'Default Dark',
		});
		await positronUserSettings.set({
			'positron.importSettings.enable': true,
			'test': 'positron-settings',
			'editor.fontSize': 16,
			'workbench.colorTheme': 'Default Light+',
		}, { reload: true, waitMs: 1000 });
	});

	test.beforeEach(async ({ sessions, hotKeys }) => {
		await sessions.expectNoStartUpMessaging(); // necessary to ensure that the import prompt is shown
		await hotKeys.closeAllEditors();
	});

	test.describe('Defer Import', () => {
		test('Verify import prompt behavior on "Later"', async ({ app, hotKeys }) => {
			const { toasts } = app.workbench;

			// select "Later" and verify that the prompt is no longer visible
			await toasts.expectImportSettingsToastToBeVisible();
			await toasts.clickButton('Later');
			await toasts.expectImportSettingsToastToBeVisible(false);

			// reload the window and verify that the prompt is shown again
			await hotKeys.reloadWindow();
			await toasts.expectImportSettingsToastToBeVisible();
		});

		test('Verify import prompt behavior on "Don\'t Show Again"', async ({ sessions, app, hotKeys, page }) => {
			const { toasts } = app.workbench;

			// select "Don't Show Again" and verify that the prompt is no longer visible
			await toasts.expectImportSettingsToastToBeVisible();
			await toasts.clickButton("Don't Show Again");
			await toasts.expectImportSettingsToastToBeVisible(false);

			// verify that prompt is not shown again
			await hotKeys.reloadWindow();
			await sessions.expectNoStartUpMessaging();
			await page.waitForTimeout(3000); // extra time to ensure the prompt is not shown
			await toasts.expectImportSettingsToastToBeVisible(false);
		});
	});

	test.describe('Import with Positron settings', () => {
		test('Verify diff displays and rejected settings are not saved', async ({ app, page, hotKeys }) => {
			const { toasts } = app.workbench;
			const testSettingLocator = page.getByText('"test": "positron-settings"');

			// import settings and verify diff displays
			await hotKeys.importSettings();
			await hotKeys.minimizeBottomPanel();
			await expectDiffToBeVisible(app);

			// reject the changes
			await toasts.clickButton('Reject');
			await expectDiffToBeVisible(app, false);
			await hotKeys.openUserSettingsJSON();
			await scrollEditorUntilVisible(app, testSettingLocator);
			await expect(testSettingLocator).toHaveCount(1);
		});

		test('Verify diff displays and accepted settings are saved', async ({ app, page, hotKeys }) => {
			const { toasts } = app.workbench;

			// import settings and verify diff displays
			await hotKeys.importSettings();
			await hotKeys.minimizeBottomPanel();
			await expectDiffToBeVisible(app);

			// accept changes
			await toasts.clickButton('Accept');
			await expect(page.getByRole('tab', { name: 'settings.json' })).not.toBeVisible();
			await hotKeys.openUserSettingsJSON();
			await hotKeys.scrollToTop();
			await expect(page.getByText('Settings imported from Visual Studio Code')).toBeVisible();
		});
	});

	test.describe('Import without Positron settings', () => {
		test.beforeEach(async ({ settings }) => {
			await settings.clear();
		});

		test('Verify import import occurs and is clean without a diff', async ({ app, page, hotKeys }) => {
			const { toasts } = app.workbench;

			// import settings
			await hotKeys.importSettings();
			await expect(page.getByRole('tab', { name: 'settings.json' })).toBeVisible();

			// accept changes
			await toasts.clickButton('Accept');
			await expect(page.getByRole('tab', { name: 'settings.json' })).not.toBeVisible();

			// verify settings imported
			await hotKeys.openUserSettingsJSON();
			await expect(page.getByText('Settings imported from Visual Studio Code')).toBeVisible();
		});
	});
});

async function scrollEditorUntilVisible(
	app: Application,
	target: Locator,
	maxSteps = 25,
): Promise<void> {
	const editor = app.code.driver.page.locator(
		'.monaco-editor[data-uri*="settings.json"]',
	);

	// Focus the editor so wheel events go to the monaco scrollable element
	await app.workbench.hotKeys.scrollToTop();
	await editor.click({ position: { x: 50, y: 10 } });

	for (let i = 0; i < maxSteps; i++) {
		if (await target.isVisible()) { return; }

		// Scroll down a bit
		await app.code.driver.page.mouse.wheel(0, 300);
		// Give Monaco a moment to render new lines
		await app.code.driver.page.waitForTimeout(50);
	}

	throw new Error('Target text not visible after scrolling');
}

export async function expectDiffToBeVisible(app: Application, visible = true) {
	const editor = app.code.driver.page.locator(
		'.monaco-editor[data-uri*="settings.json"]',
	);
	const settingsTab = app.code.driver.page.getByRole('tab', { name: 'settings.json' });

	const existingStart = editor.getByText('<<<<<<< Existing', { exact: true }).first();
	const incomingEnd = editor.getByText('>>>>>>> Incoming', { exact: true }).first();

	if (visible) {
		await expect(settingsTab).toBeVisible();
		await expect(editor).toBeVisible();

		await scrollEditorUntilVisible(app, existingStart);
		await expect(existingStart).toBeVisible();

		await scrollEditorUntilVisible(app, incomingEnd);
		await expect(incomingEnd).toBeVisible();
	} else {
		await expect(settingsTab).not.toBeVisible();
		await expect(existingStart).toHaveCount(0);
		await expect(incomingEnd).toHaveCount(0);
	}
}
