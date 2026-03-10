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
_test_setup_1.test.describe('Quarto - Inline Output: Basic', {
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
    (0, _test_setup_1.test)('Python - Verify inline output appears after running a code cell', async function ({ python, app, openFile }) {
        const { editors, inlineQuarto } = app.workbench;
        // Open a Quarto file and wait for the kernel to be ready
        await openFile((0, path_1.join)('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
        await editors.waitForActiveTab('simple_plot.qmd');
        await inlineQuarto.expectKernelStatusVisible();
        // Run the cell and wait for output
        await editors.clickTab('simple_plot.qmd');
        await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });
        // Verify output content
        await inlineQuarto.expectOutputVisible();
    });
    (0, _test_setup_1.test)('Python - Verify output is not duplicated after opening multiple qmd files', async function ({ python, app, openFile }) {
        const { editors, inlineQuarto } = app.workbench;
        // Open several qmd files to trigger multiple QuartoOutputContribution initializations
        await openFile((0, path_1.join)('workspaces', 'quarto_basic', 'quarto_basic.qmd'));
        await editors.waitForActiveTab('quarto_basic.qmd');
        await openFile((0, path_1.join)('workspaces', 'quarto_interactive', 'quarto_interactive.qmd'));
        await editors.waitForActiveTab('quarto_interactive.qmd');
        await openFile((0, path_1.join)('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
        await editors.waitForActiveTab('simple_plot.qmd');
        await inlineQuarto.expectKernelStatusVisible();
        // Run the cell and wait for output
        await editors.clickTab('simple_plot.qmd');
        await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });
        // Verify there is exactly ONE output view zone, not duplicates
        await inlineQuarto.expectOutputsExist(1);
        // Verify the single output has exactly one output content area
        await inlineQuarto.expectOutputContentCount(1);
    });
    (0, _test_setup_1.test)('Python - Verify clicking X button clears inline output', async function ({ python, app, openFile }) {
        const { editors, inlineQuarto } = app.workbench;
        // Open a Quarto file and wait for the kernel to be ready
        await openFile((0, path_1.join)('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
        await editors.waitForActiveTab('simple_plot.qmd');
        await inlineQuarto.expectKernelStatusVisible();
        // Run the cell and wait for output
        await editors.clickTab('simple_plot.qmd');
        await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });
        // Scroll to make sure the output area is in view
        await inlineQuarto.gotoLine(20);
        await inlineQuarto.expectOutputVisible();
        // Close the output and verify it is cleared
        await inlineQuarto.closeOutput();
        await inlineQuarto.expectOutputsExist(0);
    });
});
//# sourceMappingURL=quarto-inline-output-basic.test.js.map