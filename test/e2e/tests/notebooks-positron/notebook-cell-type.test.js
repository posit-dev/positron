"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
const _test_setup_js_1 = require("./_test.setup.js");
_test_setup_js_1.test.use({
    suiteId: __filename
});
_test_setup_js_1.test.describe('Positron Notebooks: Cell Type', {
    tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.WEB, _test_setup_1.tags.POSITRON_NOTEBOOKS]
}, () => {
    (0, _test_setup_js_1.test)('Change cell type via command mode keyboard shortcuts', async function ({ app }) {
        const { notebooksPositron } = app.workbench;
        const code = 'print("hello")';
        await _test_setup_js_1.test.step('Create notebook and select Python kernel', async () => {
            await notebooksPositron.newNotebook();
            await notebooksPositron.kernel.select('Python');
        });
        await _test_setup_js_1.test.step('Add code to cell and run it', async () => {
            await notebooksPositron.addCodeToCell(0, code, { run: true });
            await notebooksPositron.expectOutputAtIndex(0, ['hello']);
        });
        await _test_setup_js_1.test.step('Convert to markdown', async () => {
            await notebooksPositron.performCellAction('changeToMarkdown');
        });
        await _test_setup_js_1.test.step('Verify cell is markdown and content preserved', async () => {
            await notebooksPositron.expectCellTypeAtIndexToBe(0, 'markdown');
            await notebooksPositron.expectCellContentAtIndexToBe(0, code);
        });
        await _test_setup_js_1.test.step('Convert back to code', async () => {
            await notebooksPositron.performCellAction('changeToCode');
        });
        await _test_setup_js_1.test.step('Verify cell is code, content preserved, and output restored', async () => {
            await notebooksPositron.expectCellTypeAtIndexToBe(0, 'code');
            await notebooksPositron.expectCellContentAtIndexToBe(0, code);
            await notebooksPositron.expectOutputAtIndex(0, ['hello']);
        });
    });
});
//# sourceMappingURL=notebook-cell-type.test.js.map