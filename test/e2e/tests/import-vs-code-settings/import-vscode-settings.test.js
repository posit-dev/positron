"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.expectDiffToBeVisible = expectDiffToBeVisible;
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Import VSCode Settings', { tag: [_test_setup_1.tags.VSCODE_SETTINGS, _test_setup_1.tags.WIN] }, () => {
    _test_setup_1.test.beforeAll(async ({ vsCodeSettings: vscodeUserSettings, settings: positronUserSettings }) => {
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
    _test_setup_1.test.beforeEach(async ({ sessions, hotKeys }) => {
        await sessions.expectNoStartUpMessaging(); // necessary to ensure that the import prompt is shown
        await hotKeys.closeAllEditors();
    });
    _test_setup_1.test.describe('Defer Import', () => {
        (0, _test_setup_1.test)('Verify import prompt behavior on "Later"', async ({ app, hotKeys }) => {
            const { toasts } = app.workbench;
            // select "Later" and verify that the prompt is no longer visible
            await toasts.expectImportSettingsToastToBeVisible();
            await toasts.clickButton('Later');
            await toasts.expectImportSettingsToastToBeVisible(false);
            // reload the window and verify that the prompt is shown again
            await hotKeys.reloadWindow();
            await toasts.expectImportSettingsToastToBeVisible();
        });
        (0, _test_setup_1.test)('Verify import prompt behavior on "Don\'t Show Again"', async ({ sessions, app, hotKeys, page }) => {
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
    _test_setup_1.test.describe('Import with Positron settings', () => {
        (0, _test_setup_1.test)('Verify diff displays and rejected settings are not saved', async ({ app, page, hotKeys }) => {
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
            await (0, _test_setup_1.expect)(testSettingLocator).toHaveCount(1);
        });
        (0, _test_setup_1.test)('Verify diff displays and accepted settings are saved', async ({ app, page, hotKeys }) => {
            const { toasts } = app.workbench;
            // import settings and verify diff displays
            await hotKeys.importSettings();
            await hotKeys.minimizeBottomPanel();
            await expectDiffToBeVisible(app);
            // accept changes
            await toasts.clickButton('Accept');
            await (0, _test_setup_1.expect)(page.getByRole('tab', { name: 'settings.json' })).not.toBeVisible();
            await hotKeys.openUserSettingsJSON();
            await hotKeys.scrollToTop();
            await (0, _test_setup_1.expect)(page.getByText('Settings imported from Visual Studio Code')).toBeVisible();
        });
    });
    _test_setup_1.test.describe('Import without Positron settings', () => {
        _test_setup_1.test.beforeEach(async ({ settings }) => {
            await settings.clear();
        });
        (0, _test_setup_1.test)('Verify import import occurs and is clean without a diff', async ({ app, page, hotKeys }) => {
            const { toasts } = app.workbench;
            // import settings
            await hotKeys.importSettings();
            await (0, _test_setup_1.expect)(page.getByRole('tab', { name: 'settings.json' })).toBeVisible();
            // accept changes
            await toasts.clickButton('Accept');
            await (0, _test_setup_1.expect)(page.getByRole('tab', { name: 'settings.json' })).not.toBeVisible();
            // verify settings imported
            await hotKeys.openUserSettingsJSON();
            await (0, _test_setup_1.expect)(page.getByText('Settings imported from Visual Studio Code')).toBeVisible();
        });
    });
});
async function scrollEditorUntilVisible(app, target, maxSteps = 25) {
    const editor = app.code.driver.currentPage.locator('.monaco-editor[data-uri*="settings.json"]');
    // Focus the editor so wheel events go to the monaco scrollable element
    await app.workbench.hotKeys.scrollToTop();
    await editor.click({ position: { x: 50, y: 10 } });
    for (let i = 0; i < maxSteps; i++) {
        if (await target.isVisible()) {
            return;
        }
        // Scroll down a bit
        await app.code.driver.currentPage.mouse.wheel(0, 300);
        // Give Monaco a moment to render new lines
        await app.code.driver.currentPage.waitForTimeout(50);
    }
    throw new Error('Target text not visible after scrolling');
}
async function expectDiffToBeVisible(app, visible = true) {
    const editor = app.code.driver.currentPage.locator('.monaco-editor[data-uri*="settings.json"]');
    const settingsTab = app.code.driver.currentPage.getByRole('tab', { name: 'settings.json' });
    const existingStart = editor.getByText('<<<<<<< Existing', { exact: true }).first();
    const incomingEnd = editor.getByText('>>>>>>> Incoming', { exact: true }).first();
    if (visible) {
        await (0, _test_setup_1.expect)(settingsTab).toBeVisible();
        await (0, _test_setup_1.expect)(editor).toBeVisible();
        await scrollEditorUntilVisible(app, existingStart);
        await (0, _test_setup_1.expect)(existingStart).toBeVisible();
        await scrollEditorUntilVisible(app, incomingEnd);
        await (0, _test_setup_1.expect)(incomingEnd).toBeVisible();
    }
    else {
        await (0, _test_setup_1.expect)(settingsTab).not.toBeVisible();
        await (0, _test_setup_1.expect)(existingStart).toHaveCount(0);
        await (0, _test_setup_1.expect)(incomingEnd).toHaveCount(0);
    }
}
//# sourceMappingURL=import-vscode-settings.test.js.map