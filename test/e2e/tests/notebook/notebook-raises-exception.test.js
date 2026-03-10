"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Notebooks: Cell Execution with raises-exception tag', {
    tag: [_test_setup_1.tags.NOTEBOOKS, _test_setup_1.tags.WIN, _test_setup_1.tags.WEB]
}, () => {
    _test_setup_1.test.describe('Python Notebooks', () => {
        _test_setup_1.test.beforeEach(async function ({ app, python }) {
            await app.workbench.layouts.enterLayout('notebook');
            await app.workbench.notebooks.createNewNotebook();
            await app.workbench.notebooks.selectInterpreter('Python');
        });
        _test_setup_1.test.afterEach(async function ({ hotKeys }) {
            await hotKeys.closeAllEditors();
        });
        (0, _test_setup_1.test)('Python - Execution stops at exception without raises-exception tag', async function ({ app, page, hotKeys }) {
            const { notebooks } = app.workbench;
            // Cell 1: Normal execution
            await hotKeys.scrollToTop();
            await notebooks.addCodeToCellAtIndex(0, 'print("Cell 1 executed")');
            // Cell 2: Exception without tag (should stop execution)
            await notebooks.insertNotebookCell('code');
            await notebooks.addCodeToCellAtIndex(1, 'raise ValueError("This should stop execution")');
            // Cell 3: Should NOT execute
            await notebooks.insertNotebookCell('code');
            await notebooks.addCodeToCellAtIndex(2, 'print("Cell 3 should not execute")');
            // Run all cells
            await notebooks.runAllCells();
            // Verify outputs
            await notebooks.assertCellOutput('Cell 1 executed');
            await notebooks.assertCellOutput('ValueError: This should stop execution');
            // Cell 3 should have no output
            const cell3Output = page.locator('.cell-inner-container > .cell').nth(2).locator('.output');
            await (0, _test_setup_1.expect)(cell3Output).not.toBeVisible();
        });
        (0, _test_setup_1.test)('Python - Execution continues after exception with raises-exception tag', async function ({ app, page, hotKeys }) {
            const { notebooks, quickInput } = app.workbench;
            // Cell 1: Normal execution
            await hotKeys.scrollToTop();
            await notebooks.addCodeToCellAtIndex(0, 'print("Cell 1 executed")');
            // Cell 2: Exception with raises-exception tag
            await notebooks.insertNotebookCell('code');
            await notebooks.addCodeToCellAtIndex(1, 'raise ValueError("Expected error - execution should continue")');
            // Add raises-exception tag to Cell 2
            // First, ensure the cell is selected
            await page.locator('.cell-inner-container > .cell').nth(1).click();
            // Run the add tag command
            await hotKeys.jupyterCellAddTag();
            // Type the tag name in the quick input
            await quickInput.waitForQuickInputOpened();
            await quickInput.type('raises-exception');
            // Press Enter key to submit (there's no okay button to press)
            await page.keyboard.press('Enter');
            // Cell 3: Should execute despite Cell 2 error
            await notebooks.insertNotebookCell('code');
            await notebooks.addCodeToCellAtIndex(2, 'print("Cell 3 executed successfully!")');
            // Run all cells by clicking the "Run All" button
            await notebooks.runAllCells();
            // Verify outputs
            await notebooks.assertCellOutput('Cell 1 executed');
            await notebooks.assertCellOutput('ValueError: Expected error - execution should continue');
            await notebooks.assertCellOutput('Cell 3 executed successfully!');
        });
    });
});
//# sourceMappingURL=notebook-raises-exception.test.js.map