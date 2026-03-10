"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('R Package Development', { tag: [_test_setup_1.tags.R_PKG_DEVELOPMENT, _test_setup_1.tags.ARK] }, () => {
    _test_setup_1.test.beforeAll(async function ({ app, r, settings }) {
        try {
            // don't use native file picker
            await settings.set({
                'files.simpleDialog.enable': true,
                'interpreters.startupBehavior': 'auto'
            });
            await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
            await app.workbench.console.clearButton.click();
            await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
        }
        catch (e) {
            await app.code.driver.takeScreenshot('rPackageSetup');
            throw e;
        }
    });
    (0, _test_setup_1.test)('R - Verify can open, test, check, install, and restart package', async function ({ app, openFolder, logger, settings }) {
        _test_setup_1.test.slow();
        // Open an R package embedded in qa-example-content
        await openFolder(path.join('qa-example-content/workspaces/r_testing'));
        await app.workbench.console.waitForReadyAndStarted('>', 45000);
        await _test_setup_1.test.step('Test R Package', async () => {
            logger.log('Test R Package');
            await app.workbench.quickaccess.runCommand('r.packageTest');
            await (0, _test_setup_1.expect)(async () => {
                await app.workbench.terminal.waitForTerminalText('[ FAIL 1 | WARN 0 | SKIP 1 | PASS 16 ]', { timeout: 20000 });
                await app.workbench.terminal.waitForTerminalText('Terminal will be reused by tasks', { timeout: 20000 });
            }).toPass({ timeout: 70000 });
        });
        await _test_setup_1.test.step('Check R Package', async () => {
            logger.log('Check R Package');
            await app.workbench.quickaccess.runCommand('workbench.action.terminal.clear');
            await app.workbench.quickaccess.runCommand('r.packageCheck');
            await (0, _test_setup_1.expect)(async () => {
                await app.workbench.terminal.waitForTerminalText('Error: R CMD check found ERRORs', { timeout: 20000 });
                await app.workbench.terminal.waitForTerminalText('Terminal will be reused by tasks', { timeout: 20000 });
            }).toPass({ timeout: 70000 });
        });
        await _test_setup_1.test.step('Install R Package and Restart R', async () => {
            logger.log('Install R Package and Restart R');
            await app.workbench.quickaccess.runCommand('r.packageInstall');
            // Appears very briefly and test misses it:
            // await app.workbench.terminal.waitForTerminalText('✔ Installed testfun 0.0.0.9000');
            await app.workbench.console.waitForConsoleContents('restarted', { timeout: 30000 });
            await app.workbench.console.waitForConsoleContents('library(testfun)', { timeout: 30000 });
            await app.workbench.console.pasteCodeToConsole('(.packages())');
            await app.workbench.console.sendEnterKey();
            await app.workbench.console.waitForConsoleContents('"testfun"');
        });
        await _test_setup_1.test.step('Install R Package with base R and Restart R', async () => {
            logger.log('Install R Package with base R and Restart R');
            await settings.set({ 'positron.r.localPackageInstallMethod': 'base' });
            await app.workbench.quickaccess.runCommand('workbench.action.terminal.clear');
            await app.workbench.console.clearButton.click();
            await app.workbench.quickaccess.runCommand('r.packageInstall');
            await app.workbench.console.waitForConsoleContents('restarted', { timeout: 30000 });
            await app.workbench.console.waitForConsoleContents('library(testfun)', { timeout: 30000 });
            await app.workbench.console.pasteCodeToConsole('(.packages())');
            await app.workbench.console.sendEnterKey();
            await app.workbench.console.waitForConsoleContents('"testfun"');
            // Reset setting to default
            await settings.set({ 'positron.r.localPackageInstallMethod': 'pak' });
        });
    });
});
//# sourceMappingURL=r-pkg-development.test.js.map