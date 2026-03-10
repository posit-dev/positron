"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Shiny Application', { tag: [_test_setup_1.tags.APPS, _test_setup_1.tags.VIEWER, _test_setup_1.tags.WIN, _test_setup_1.tags.WEB] }, () => {
    // No longer need to install Shiny extension
    _test_setup_1.test.afterEach(async function ({ app }) {
        await app.workbench.terminal.sendKeysToTerminal('Control+C');
        await app.workbench.viewer.refreshViewer();
    });
    (0, _test_setup_1.test)('Python - Verify Basic Shiny App', async function ({ app, page, python }) {
        await app.workbench.quickaccess.openFile((0, path_1.join)(app.workspacePathOrFolder, 'workspaces', 'shiny-py-example', 'app.py'));
        await app.workbench.quickaccess.runCommand('shiny.python.runApp');
        const headerLocator = app.web
            ? app.workbench.viewer.viewerFrame.frameLocator('iframe').locator('h1')
            : app.workbench.viewer.getViewerLocator('h1');
        await (0, _test_setup_1.expect)(async () => {
            // Check if "Keep waiting" button appears and click it if present
            const keepWaitingButton = app.workbench.toasts.getOptionButton('Keep waiting');
            if (await keepWaitingButton.isVisible({ timeout: 10000 }).catch(() => false)) {
                await keepWaitingButton.click();
            }
            await (0, _test_setup_1.expect)(headerLocator).toHaveText('Restaurant tipping', { timeout: 20000 });
        }).toPass({ timeout: 60000 });
        // Verify the interrupt button is visible and works
        const interruptButton = page.locator('.positron-action-bar').getByRole('button', { name: 'Interrupt execution' });
        await (0, _test_setup_1.expect)(interruptButton).toBeVisible({ timeout: 10000 });
        await interruptButton.click();
        await (0, _test_setup_1.expect)(interruptButton).not.toBeVisible({ timeout: 5000 });
    });
    (0, _test_setup_1.test)('R - Verify Basic Shiny App', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, r }) {
        const code = `library(shiny)
runExample("01_hello")`;
        await app.workbench.console.pasteCodeToConsole(code);
        await app.workbench.console.sendEnterKey();
        const headerLocator = app.web
            ? app.workbench.viewer.viewerFrame.frameLocator('iframe').locator('h1')
            : app.workbench.viewer.getViewerLocator('h1');
        await (0, _test_setup_1.expect)(async () => {
            await (0, _test_setup_1.expect)(headerLocator).toHaveText('Hello Shiny!', { timeout: 20000 });
        }).toPass({ timeout: 60000 });
    });
});
//# sourceMappingURL=shiny.test.js.map