"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
// TO RUN THIS TEST:
// remove this line of code from playwright.config.ts: `testIgnore: '**/example.test.ts`
// we must import test from _test.setup to ensure we have the correct test
// context which enables our custom fixtures
const _test_setup_1 = require("./_test.setup");
// we need this to ensure each spec gets a fresh app instance read more here:
// https://positpbc.atlassian.net/wiki/spaces/POSITRON/pages/1224999131/Proof+of+Concept+Playwright#SuiteId
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Examples of Concepts', () => {
    _test_setup_1.test.beforeAll('How to set User Settings', async function ({ settings }) {
        // we set the workplace settings before all tests in a spec begin
        // the fixture cleans up and unsets after all tests have finished
        await settings.set({ 'files.autoSave': false });
    });
    (0, _test_setup_1.test)('How to use app instance', async function ({ app }) {
        // the "app" fixture is automatically created and available for use in all tests
        // we just need to reference it in the test function signature to use it
        // note: the app instance is re-created for EACH SPEC FILE
        await (0, _test_setup_1.expect)(app.code.driver.currentPage.getByLabel('Start Interpreter')).toBeVisible();
    });
    (0, _test_setup_1.test)('How to use page instance', async function ({ app, page }) {
        // the first step in this test accesses the page instance directly via the app
        // object (app.code.driver.currentPage), while the second step in this test uses the "page" fixture
        // which is just passing the same app object directly, therefore simplifying the code
        await (0, _test_setup_1.expect)(app.code.driver.currentPage.getByLabel('Start Interpreter')).toBeVisible();
        await (0, _test_setup_1.expect)(page.getByLabel('Start Interpreter')).toBeVisible();
    });
    (0, _test_setup_1.test)('How to use logger', async function ({ logger }) {
        // the "logger" fixture is automatically created and available for use in all tests
        // we just need to reference it in the test function signature to use it
        // log files can be found at: /test-logs and are also attached to the HTML report
        logger.log("This will show up in the log files");
    });
    (0, _test_setup_1.test)('How to set Python/R interpreter at start of test', async function ({ page, r }) {
        // we can invoke the "r" interpreter fixture, which will set the interpreter to R
        // before any of the test steps execute
        await (0, _test_setup_1.expect)(page.getByText(/R.*started/)).toBeVisible();
    });
    (0, _test_setup_1.test)('How to set Python/R interpreter anywhere in test', async function ({ page, sessions }) {
        // we can invoke the "sessions" fixture, and then set the interpreter to Python or R
        // from anywhere within our test
        await (0, _test_setup_1.expect)(page.getByText(/R.*started|Start Interpreter/)).toBeVisible();
        await sessions.start('python');
        await (0, _test_setup_1.expect)(page.getByText(/Python.*started/)).toBeVisible();
    });
    (0, _test_setup_1.test)('How to restart app instance at start of test', async function ({ restartApp: app }) {
        // in some cases you may want to restart the app instance within a spec file
        // this example uses the "restartApp" fixture which restarts the app instance
        // before any of test steps execute
        await (0, _test_setup_1.expect)(app.code.driver.currentPage.getByLabel('Start Interpreter')).toBeVisible();
    });
    (0, _test_setup_1.test)('How to restart app instance anywhere in test', async function ({ app }) {
        // this example call the restart method on the app instance, which can be used
        // from anywhere within the test
        await app.restart();
        await (0, _test_setup_1.expect)(app.code.driver.currentPage.getByLabel('Start Interpreter')).toBeVisible();
    });
});
_test_setup_1.test.describe('Example Context Menu Tests', { tag: [_test_setup_1.tags.WEB] }, () => {
    (0, _test_setup_1.test)("Context Menu Open Bash", async function ({ app, page }) {
        await app.workbench.terminal.clickTerminalTab();
        await app.workbench.contextMenu.triggerAndClick({
            menuTrigger: page.getByLabel('Launch Profile...'),
            menuItemLabel: 'bash'
        });
        await (0, _test_setup_1.expect)(page.getByLabel('$(terminal-bash) bash')).toBeVisible();
    });
    (0, _test_setup_1.test)("Context Menu Fail Open Bash", async function ({ app, page }) {
        await app.workbench.terminal.clickTerminalTab();
        await app.workbench.contextMenu.triggerAndClick({
            menuTrigger: page.getByLabel('Launch Profile...'),
            menuItemLabel: 'zsh'
        });
        await (0, _test_setup_1.expect)(page.getByLabel('$(terminal) zsh')).toBeVisible();
    });
});
//# sourceMappingURL=example.test.js.map