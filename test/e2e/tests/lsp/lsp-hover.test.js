"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Hover', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.EDITOR]
}, () => {
    _test_setup_1.test.afterEach(async function ({ app }) {
        await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
    });
    (0, _test_setup_1.test)('Python - Verify pd.DataFrame hover shows preview', async function ({ app, page, python }) {
        await app.workbench.quickaccess.openFile((0, path_1.join)(app.workspacePathOrFolder, 'workspaces', 'generate-data-frames-py', 'simple-data-frames.py'));
        // Double-click "df" to select it and position the cursor.
        await page.locator('span').filter({ hasText: 'print(df)' }).locator('span').filter({ hasText: 'df' }).dblclick();
        // The first time we should get the Pyrefly hover.
        const hoverContent = page.locator('.monaco-hover:not(.hidden) .monaco-hover-content');
        await (0, _test_setup_1.expect)(async () => {
            await app.workbench.quickaccess.runCommand('editor.action.hideHover');
            await app.workbench.quickaccess.runCommand('editor.action.showHover');
            await (0, _test_setup_1.expect)(hoverContent).toBeVisible();
            await (0, _test_setup_1.expect)(hoverContent).toContainText('(variable) df');
        }).toPass({ timeout: 60000 });
        // Run the file.
        await app.workbench.quickaccess.runCommand('python.execInConsole');
        // Hover again, and this time we should get the rich hover with the dataframe preview.
        await (0, _test_setup_1.expect)(async () => {
            await app.workbench.quickaccess.runCommand('editor.action.hideHover');
            await app.workbench.quickaccess.runCommand('editor.action.showHover');
            await (0, _test_setup_1.expect)(hoverContent).toBeVisible();
            await (0, _test_setup_1.expect)(hoverContent).toContainText('Training', { timeout: 1000 }); // a column name
        }).toPass({ timeout: 60000 });
    });
});
//# sourceMappingURL=lsp-hover.test.js.map