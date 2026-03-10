"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Console Pane: R', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.CONSOLE, _test_setup_1.tags.WIN, _test_setup_1.tags.ARK]
}, () => {
    _test_setup_1.test.beforeAll(async function ({ app }) {
        // Need to make console bigger to see all bar buttons
        await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
    });
    (0, _test_setup_1.test)('R - Verify cat from .Rprofile', async function ({ app, r }) {
        await (0, _test_setup_1.expect)(async () => {
            await app.workbench.console.waitForConsoleContents('cat from .Rprofile');
        }).toPass();
    });
    (0, _test_setup_1.test)('R - Verify cancel button on console bar', async function ({ app, r }) {
        await app.workbench.console.pasteCodeToConsole('Sys.sleep(10)');
        await app.workbench.console.sendEnterKey();
        await app.workbench.console.interruptExecution();
        // nothing appears in console after interrupting execution
    });
    (0, _test_setup_1.test)('R - Verify password prompt', async function ({ app, r }) {
        await app.workbench.console.pasteCodeToConsole('out <- rstudioapi::askForPassword("enter password")', true);
        await app.workbench.quickInput.type('password');
        await app.code.driver.currentPage.keyboard.press('Enter');
        await app.workbench.layouts.enterLayout('stacked');
        await app.workbench.layouts.enterLayout('fullSizedAuxBar');
        await (0, _test_setup_1.expect)(async () => {
            const variablesMap = await app.workbench.variables.getFlatVariables();
            (0, _test_setup_1.expect)(variablesMap.get('out')?.value).toBe('"password"');
        }).toPass({ timeout: 20000 });
        await app.workbench.layouts.enterLayout('stacked');
    });
    (0, _test_setup_1.test)('R - Verify console commands are queued during execution', async function ({ app, r }) {
        await app.workbench.console.pasteCodeToConsole('123 + 123');
        await app.workbench.console.executeCode('R', '456 + 456');
        await app.workbench.console.waitForConsoleContents('912', { expectedCount: 1, timeout: 10000 });
        await app.workbench.console.waitForConsoleContents('123 + 123', { expectedCount: 1, timeout: 10000 });
        await app.workbench.console.waitForConsoleContents('246', { expectedCount: 0, timeout: 5000 });
    });
});
//# sourceMappingURL=console-r.test.js.map