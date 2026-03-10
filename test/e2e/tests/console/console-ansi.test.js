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
_test_setup_1.test.describe('Console ANSI styling', { tag: [_test_setup_1.tags.CONSOLE, _test_setup_1.tags.WIN, _test_setup_1.tags.WEB] }, () => {
    _test_setup_1.test.beforeEach(async function ({ app }) {
        await app.workbench.layouts.enterLayout('fullSizedPanel');
    });
    (0, _test_setup_1.test)("R - Can produce clickable file links", {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, r }) {
        // Can be any file on the workspace. We use .gitignore as it's probably
        // always there.
        const fileName = '.gitignore';
        const filePath = (0, path_1.join)(app.workspacePathOrFolder, fileName);
        const inputCode = `cli::cli_inform(r"[{.file ${filePath}}]")`;
        await (0, _test_setup_1.expect)(async () => {
            await app.workbench.console.pasteCodeToConsole(inputCode);
            await app.workbench.console.sendEnterKey();
            // Locate the link and click on it
            const link = app.workbench.console.getLastClickableLink();
            await (0, _test_setup_1.expect)(link).toContainText(fileName, { useInnerText: true });
            await link.click();
            await app.workbench.editors.waitForActiveTab(fileName);
        }).toPass({ timeout: 60000 });
    });
    (0, _test_setup_1.test)("R - Can produce clickable help links", {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, r }) {
        const inputCode = `cli::cli_inform("{.fun base::mean}")`;
        await (0, _test_setup_1.expect)(async () => {
            await app.workbench.console.pasteCodeToConsole(inputCode);
            await app.workbench.console.sendEnterKey();
            // Locate the link and click on it
            const link = app.workbench.console.getLastClickableLink();
            await (0, _test_setup_1.expect)(link).toContainText('base::mean', { useInnerText: true });
            await link.click();
            await app.code.wait(200);
            const helpFrame = await app.workbench.help.getHelpFrame(0);
            await (0, _test_setup_1.expect)(helpFrame.locator('body')).toContainText('Arithmetic Mean');
        }).toPass({ timeout: 60000 });
    });
    (0, _test_setup_1.test)("R - Can produce colored output", {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, r }) {
        const color = '#ff3333';
        const rgb_color = "rgb(255, 51, 51)"; // same as above but in rgb
        await (0, _test_setup_1.expect)(async () => {
            await app.workbench.console.pasteCodeToConsole(`
						cli::cli_div(theme = list(span.emph = list(color = "${color}")))
						cli::cli_text("This is very {.emph important}")
						cli::cli_end()
						`);
        }).toPass();
        await app.workbench.console.sendEnterKey();
        const styled_locator = app.workbench.console.activeConsole.getByText("important").last();
        await (0, _test_setup_1.expect)(styled_locator).toHaveCSS('font-style', 'italic');
        await (0, _test_setup_1.expect)(styled_locator).toHaveCSS('color', rgb_color);
    });
});
//# sourceMappingURL=console-ansi.test.js.map