"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
/*
Summary:
- This test suite verifies the functionality of interpreter commands via Interrupt and Clear for both Python and R.
- Tests confirm that each quick input command triggers the expected behavior, verified through console outputs (see Table below).
- After each test, console is cleared and session is fully deleted. Doing both for each test makes the tests more robust indeed.

 * |Command   |Language|Targeted Console Output    |
 * |----------|--------|---------------------------|
 * |Interrupt |Python  |'KeyboardInterrupt'        |
 * |Interrupt |R       |Empty error line (visible) |
 * |Clear     |Python  |'int... has been cleared'  |
 * |Clear     |R       |'int... has been cleared'  |
 */
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Interpreter Commands (Force Quit, Interrupt, Shutdown, Clear Interpreter, and Rename Active Session', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.INTERPRETER]
}, () => {
    _test_setup_1.test.afterEach(async ({ app }) => {
        await app.workbench.console.clearButton.click();
        await app.workbench.sessions.deleteAll();
    });
    // Skip this test for tags.WIN (e2e-windows) due to Bug #4604
    (0, _test_setup_1.test)('Verify Interrupt Interpreter command works (→ KeyboardInterrupt) - Python', async function ({ app, python }) {
        await app.workbench.console.executeCode('Python', 'import time; time.sleep(5)', { waitForReady: false });
        await app.workbench.quickaccess.runCommand('workbench.action.languageRuntime.interrupt');
        await app.workbench.console.waitForConsoleContents('KeyboardInterrupt');
    });
    (0, _test_setup_1.test)('Verify Interrupt Interpreter command works (→ empty error line) - R', { tag: [_test_setup_1.tags.WIN] }, async function ({ app, page, r }) {
        await app.workbench.console.executeCode('R', 'Sys.sleep(5)', { waitForReady: false });
        await app.workbench.quickaccess.runCommand('workbench.action.languageRuntime.interrupt');
        await (0, _test_setup_1.expect)(page.locator('div.activity-error-stream')).toBeVisible();
    });
    (0, _test_setup_1.test)('Verify Clear Saved Interpreter command works (→ interpreter has been cleared) - Python', { tag: [_test_setup_1.tags.WIN] }, async function ({ app, python, page }) {
        await app.workbench.quickaccess.runCommand('workbench.action.languageRuntime.clearAffiliatedRuntime', { keepOpen: true });
        await app.workbench.quickInput.waitForQuickInputOpened();
        const anyPythonSession = app.workbench.quickInput.quickInputList.getByText(/Python:/);
        await anyPythonSession.waitFor({ state: 'visible' });
        await page.keyboard.press('Enter');
        await app.workbench.quickInput.waitForQuickInputClosed();
        await app.workbench.toasts.expectToastWithTitle(/Python .* interpreter has been cleared/);
    });
    (0, _test_setup_1.test)('Verify Clear Saved Interpreter command works (→ interpreter has been cleared) - R', { tag: [_test_setup_1.tags.WIN] }, async function ({ app, r, page }) {
        await app.workbench.quickaccess.runCommand('workbench.action.languageRuntime.clearAffiliatedRuntime', { keepOpen: true });
        await app.workbench.quickInput.waitForQuickInputOpened();
        const anyRSession = app.workbench.quickInput.quickInputList.getByText(/R:/);
        await anyRSession.waitFor({ state: 'visible' });
        await page.keyboard.press('Enter');
        await app.workbench.quickInput.waitForQuickInputClosed();
        await app.workbench.toasts.expectToastWithTitle(/R .* interpreter has been cleared/);
    });
});
//# sourceMappingURL=interpreter-commands.test.js.map