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
_test_setup_1.test.describe('Console History', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.CONSOLE]
}, () => {
    _test_setup_1.test.afterEach(async function ({ page }) {
        page.keyboard.press('Escape');
    });
    (0, _test_setup_1.test)('Python - Verify first history and full history', async function ({ app, page, python }) {
        const pythonLines = [
            'a = 1',
            'b = 2',
            'c = 3'
        ];
        await enterLines(app, pythonLines);
        await clearConsole(app);
        await selectFirstHistoryResult(app, pythonLines[0]);
        await verifyFullHistory(app, pythonLines);
        await clearConsole(app);
    });
    (0, _test_setup_1.test)('R - Verify first history and full history', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, page, r }) {
        const rLines = [
            'a <- 1',
            'b <- 2',
            'c <- 3'
        ];
        await enterLines(app, rLines);
        await clearConsole(app);
        await selectFirstHistoryResult(app, rLines[0]);
        await verifyFullHistory(app, rLines);
        await clearConsole(app);
    });
});
async function enterLines(app, lines) {
    await _test_setup_1.test.step('Enter lines into the console', async () => {
        for (const line of lines) {
            await app.workbench.console.typeToConsole(line);
            await app.workbench.console.sendEnterKey();
            await app.workbench.console.waitForConsoleContents(line);
        }
    });
}
async function clearConsole(app) {
    await _test_setup_1.test.step('Clear the console', async () => {
        await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
        await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
        await app.workbench.console.clearButton.click();
    });
}
async function selectFirstHistoryResult(app, expectedLine) {
    await _test_setup_1.test.step('Select first history result', async () => {
        const page = app.code.driver.currentPage;
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');
        await app.workbench.console.waitForCurrentConsoleLineContents(expectedLine);
        await app.workbench.console.sendEnterKey();
    });
}
async function verifyFullHistory(app, lines) {
    await _test_setup_1.test.step('Verify the full history', async () => {
        await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
        await app.workbench.console.clearButton.click();
        await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
        await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
        await app.code.driver.currentPage.keyboard.press('Control+R');
        await app.workbench.console.waitForHistoryContents(lines[0], 2);
        await app.workbench.console.waitForHistoryContents(lines[1]);
        await app.workbench.console.waitForHistoryContents(lines[2]);
    });
}
//# sourceMappingURL=console-history.test.js.map