"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Python Scratch File', { tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.EDITOR, _test_setup_1.tags.WIN] }, () => {
    (0, _test_setup_1.test)('Verify that lines in a python scratch file with magics can be executed', async function ({ app, python, runCommand }) {
        const filename = 'Untitled-1';
        await _test_setup_1.test.step('Create a new python scratch file with code and a magic', async () => {
            await runCommand('python.createNewFile');
            await app.workbench.editor.type('print("test")\n\n%pip install pyarrow');
        });
        await _test_setup_1.test.step('Exexcute first line of code', async () => {
            await app.workbench.editor.clickOnTerm(filename, 'print', 1, true);
            await app.code.driver.currentPage.keyboard.press('ArrowLeft');
            await app.code.driver.currentPage.keyboard.press('Control+Enter');
        });
        // ensure code execution worked
        await app.workbench.console.waitForConsoleContents('test', { expectedCount: 2 });
        // Ensure "deprecated" does not appear in the console
        await app.workbench.console.waitForConsoleContents('deprecated', { timeout: 5000, expectedCount: 0 });
    });
});
//# sourceMappingURL=python-scratch-file-execution.test.js.map