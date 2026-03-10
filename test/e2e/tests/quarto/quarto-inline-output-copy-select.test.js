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
_test_setup_1.test.describe('Quarto - Inline Output: Copy and Select', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.QUARTO]
}, () => {
    _test_setup_1.test.beforeAll(async function ({ settings }) {
        await settings.set({
            'positron.quarto.inlineOutput.enabled': true
        }, { reload: 'web' });
    });
    _test_setup_1.test.afterEach(async function ({ hotKeys }) {
        await hotKeys.closeAllEditors();
    });
    (0, _test_setup_1.test)('Python - Verify text can be selected via click and drag in inline output', async function ({ python, app, openFile }) {
        const { editors, inlineQuarto } = app.workbench;
        // Open a Quarto file and wait for the kernel to be ready
        await openFile((0, path_1.join)('workspaces', 'quarto_inline_output', 'text_output.qmd'));
        await editors.waitForActiveTab('text_output.qmd');
        await inlineQuarto.expectKernelStatusVisible();
        // Run the cell and wait for output
        await editors.clickTab('text_output.qmd');
        await inlineQuarto.runCellAndWaitForOutput({ cellLine: 13, outputLine: 20 });
        await inlineQuarto.expectStdoutContains('Hello World');
        // Select text via drag and verify
        await inlineQuarto.selectStdoutTextViaDrag();
        await inlineQuarto.expectTextSelectedAndContains(['World', 'Hello', 'additional', 'text', 'Line']);
    });
    (0, _test_setup_1.test)('Python - Verify copy button appears in inline output and shows success feedback', async function ({ python, app, openFile }) {
        const { editors, inlineQuarto } = app.workbench;
        // Open a Quarto file and wait for the kernel to be ready
        await openFile((0, path_1.join)('workspaces', 'quarto_inline_output', 'copy_output_test.qmd'));
        await editors.waitForActiveTab('copy_output_test.qmd');
        await inlineQuarto.expectKernelStatusVisible();
        // Run the cell and wait for output
        await editors.clickTab('copy_output_test.qmd');
        await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 18 });
        // Copy and verify success feedback
        await inlineQuarto.copyOutput();
        // Wait for success state to revert
        await inlineQuarto.expectCopySuccessReverted();
    });
    (0, _test_setup_1.test)('Python - Verify copy output command copies text from cell output', async function ({ python, app, openFile }) {
        const { editors, inlineQuarto } = app.workbench;
        // Open a Quarto file and wait for the kernel to be ready
        await openFile((0, path_1.join)('workspaces', 'quarto_inline_output', 'text_output.qmd'));
        await editors.waitForActiveTab('text_output.qmd');
        await inlineQuarto.expectKernelStatusVisible();
        // Run the cell and wait for output
        await editors.clickTab('text_output.qmd');
        await inlineQuarto.runCellAndWaitForOutput({ cellLine: 13, outputLine: 20 });
        // Position cursor back in cell and use copy command
        await inlineQuarto.gotoLine(13);
        await inlineQuarto.runCopyCommand();
        // Verify success feedback
        await inlineQuarto.expectCopySuccess();
    });
});
//# sourceMappingURL=quarto-inline-output-copy-select.test.js.map