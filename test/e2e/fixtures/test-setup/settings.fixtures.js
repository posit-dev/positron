"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsFixture = SettingsFixture;
function SettingsFixture(app) {
    const { settings } = app.workbench;
    return {
        set: async (newSettings, options) => {
            const { reload = false, waitMs = 0, waitForReady = true, keepOpen = false } = options || {};
            await settings.set(newSettings, { keepOpen });
            if (reload === true || (reload === 'web' && app.web === true)) {
                await app.workbench.hotKeys.reloadWindow(false);
            }
            if (waitMs) {
                await app.code.driver.currentPage.waitForTimeout(waitMs); // wait for settings to take effect
            }
            if (waitForReady) {
                await app.code.driver.currentPage.waitForTimeout(3000);
                await app.code.driver.currentPage.locator('.monaco-workbench').waitFor({ state: 'visible' });
                await app.workbench.sessions.expectNoStartUpMessaging();
            }
        },
        clear: () => settings.clear(),
        remove: (settingsToRemove) => settings.remove(settingsToRemove),
    };
}
//# sourceMappingURL=settings.fixtures.js.map