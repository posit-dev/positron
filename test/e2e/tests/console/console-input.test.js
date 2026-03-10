"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Console Input', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.CRITICAL, _test_setup_1.tags.WIN, _test_setup_1.tags.CONSOLE]
}, () => {
    _test_setup_1.test.beforeEach(async function ({ app }) {
        await app.workbench.layouts.enterLayout('fullSizedPanel');
    });
    (0, _test_setup_1.test)('Python - Can get input string via console', async function ({ app, python }) {
        const inputCode = `val = input("Enter your name: "); print(f'Hello {val}!');`;
        await app.workbench.console.pasteCodeToConsole(inputCode);
        await app.workbench.console.sendEnterKey();
        await (0, _test_setup_1.expect)(app.workbench.console.activeConsole.getByText('Enter your name:', { exact: true })).toBeVisible();
        await app.workbench.console.typeToConsole('John Doe');
        await app.workbench.console.sendEnterKey();
        await app.workbench.console.waitForConsoleContents('Hello John Doe!');
    });
    (0, _test_setup_1.test)('R - Can get input string via console', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, r }) {
        const inputCode = `val <- readline(prompt = "Enter your name: ")
cat(sprintf('Hello %s!\n', val))`;
        await app.workbench.console.pasteCodeToConsole(inputCode);
        await app.workbench.console.sendEnterKey();
        await (0, _test_setup_1.expect)(app.workbench.console.activeConsole.getByText('Enter your name:', { exact: true })).toBeVisible();
        // slight wait before starting to type
        await app.code.wait(200);
        await app.workbench.console.typeToConsole('John Doe');
        await app.workbench.console.sendEnterKey();
        await app.workbench.console.waitForConsoleContents('Hello John Doe!');
    });
    (0, _test_setup_1.test)('R - Can use `menu` to select alternatives', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, r }) {
        const inputCode = `x <- menu(letters)`;
        await app.workbench.console.pasteCodeToConsole(inputCode);
        await app.workbench.console.sendEnterKey();
        await app.workbench.console.waitForConsoleContents('Selection:');
        await app.workbench.console.typeToConsole('1');
        await app.workbench.console.sendEnterKey();
        await app.workbench.console.typeToConsole('x');
        await app.workbench.console.sendEnterKey();
        await app.workbench.console.waitForConsoleContents('[1] 1');
    });
    (0, _test_setup_1.test)("R - Verify ESC dismisses autocomplete without deleting typed text", {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, page, r }) {
        // This is a regression test for https://github.com/posit-dev/positron/issues/1161
        const inputCode = `base::mea`;
        await app.workbench.console.typeToConsole(inputCode);
        const activeConsole = app.workbench.console.activeConsole;
        // Makes sure the code suggestions are activated
        const suggestion = activeConsole.locator('.suggest-widget');
        await (0, _test_setup_1.expect)(suggestion).toBeVisible();
        // We now send `Esc` to dismiss the suggestion
        await page.keyboard.press('Escape');
        await (0, _test_setup_1.expect)(suggestion).toBeHidden();
        const inputLocator = activeConsole.locator(".console-input");
        // Send the next `Esc`, that shouldn't cleanup the typed text
        await page.keyboard.press('Escape');
        await (0, _test_setup_1.expect)(inputLocator).toContainText('base::mea');
        // We can clear the console text with Ctrl + C
        await page.keyboard.press('Control+C');
        await (0, _test_setup_1.expect)(inputLocator).not.toContainText("base::mea");
    });
});
//# sourceMappingURL=console-input.test.js.map