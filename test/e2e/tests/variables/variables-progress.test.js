"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Variables - Progress bar', { tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.VARIABLES] }, () => {
    _test_setup_1.test.afterEach(async function ({ hotKeys }) {
        await hotKeys.stackedLayout();
    });
    (0, _test_setup_1.test)('Run a long computation and see the progress bar appearing', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, sessions }) {
        const session1 = await sessions.start('r');
        await app.workbench.layouts.enterLayout('fullSizedAuxBar');
        await app.workbench.console.pasteCodeToConsole('hello <- 1; foo <- 2', true);
        await app.workbench.console.pasteCodeToConsole('Sys.sleep(20)', true);
        const { variables, modals, console } = app.workbench;
        await (0, _test_setup_1.expect)(async () => {
            (0, _test_setup_1.expect)(await variables.hasProgressBar()).toBe(false);
        }).toPass({ timeout: 2000 });
        // Now click delete all variables an expect the progress bar to appear
        await variables.clickDeleteAllVariables();
        await modals.expectToBeVisible('Delete All Variables');
        await modals.clickButton('Delete');
        // Wait for the progress bar to appear
        await (0, _test_setup_1.expect)(async () => {
            (0, _test_setup_1.expect)(await variables.hasProgressBar()).toBe(true);
        }).toPass({ timeout: 5000 });
        // Wait for the progress bar to disappear
        await (0, _test_setup_1.expect)(async () => {
            (0, _test_setup_1.expect)(await variables.hasProgressBar()).toBe(false);
        }).toPass({ timeout: 30000 });
        // Next critical UI path is that we need to not show the progress bar when
        // user switches between sessions.
        // startup new session
        const session2 = await sessions.start('r', { reuse: false });
        await sessions.select(session2.id);
        await console.pasteCodeToConsole('hello <- 1; foo <- 2', true);
        await console.pasteCodeToConsole('Sys.sleep(20)', true);
        // Now click delete all variables an expect the progress bar to appear
        await variables.clickDeleteAllVariables();
        await modals.expectToBeVisible('Delete All Variables');
        await modals.clickButton('Delete');
        // Wait for the progress bar to appear
        await (0, _test_setup_1.expect)(async () => {
            (0, _test_setup_1.expect)(await variables.hasProgressBar()).toBe(true);
        }).toPass({ timeout: 5000 });
        // Make sure the progress bar is not shown when switching sessions
        await sessions.select(session1.id);
        await (0, _test_setup_1.expect)(async () => {
            (0, _test_setup_1.expect)(await variables.hasProgressBar()).toBe(false);
        }).toPass({ timeout: 20000 });
        // Go back to session2 and make sure the progress bar is shown
        await sessions.select(session2.id);
        await (0, _test_setup_1.expect)(async () => {
            (0, _test_setup_1.expect)(await variables.hasProgressBar()).toBe(true);
        }).toPass({ timeout: 20000 });
        // Wait for the progress bar to disappear again
        await (0, _test_setup_1.expect)(async () => {
            (0, _test_setup_1.expect)(await variables.hasProgressBar()).toBe(false);
        }).toPass({ timeout: 30000 });
    });
});
//# sourceMappingURL=variables-progress.test.js.map