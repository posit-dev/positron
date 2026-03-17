"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
const _test_setup_js_1 = require("./_test.setup.js");
_test_setup_js_1.test.use({
    suiteId: __filename
});
_test_setup_js_1.test.describe('Notebook Edit Mode', {
    tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.WEB, _test_setup_1.tags.POSITRON_NOTEBOOKS, _test_setup_1.tags.CROSS_BROWSER]
}, () => {
    _test_setup_js_1.test.beforeAll(async function ({ hotKeys }) {
        await hotKeys.minimizeBottomPanel();
    });
    (0, _test_setup_js_1.test)('Clicking/dbl clicking into cell focuses editor and enters into edit mode', async function ({ app }) {
        const { notebooksPositron } = app.workbench;
        const keyboard = app.code.driver.currentPage.keyboard;
        await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 1 });
        // Code cell: Can successfully enter edit mode by single clicking and typing
        await notebooksPositron.selectCellAtIndex(0);
        await notebooksPositron.expectCellIndexToBeSelected(0, { isSelected: true, inEditMode: true });
        await keyboard.type('cell editor good');
        await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0cell editor good');
        // Markdown cell: Can successfully enter edit mode by double clicking and typing
        await notebooksPositron.selectCellAtIndex(2, { editMode: true });
        await notebooksPositron.expectCellIndexToBeSelected(2, { isSelected: true, inEditMode: true });
        await keyboard.type('markdown editor good');
        await notebooksPositron.expectCellContentAtIndexToBe(2, 'markdown editor good### Cell 2');
    });
    (0, _test_setup_js_1.test)('Enter key on selected cell enters edit mode and doesn\'t add new lines', async function ({ app }) {
        const { notebooksPositron } = app.workbench;
        const keyboard = app.code.driver.currentPage.keyboard;
        // Create a new notebook with 3 cells
        await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 1 });
        // Code cell: Press Enter to enter edit mode and type
        await notebooksPositron.selectCellAtIndex(0, { editMode: false });
        await keyboard.press('Enter');
        await notebooksPositron.expectCellIndexToBeSelected(0, {
            isSelected: true,
            inEditMode: true
        });
        await keyboard.type('code enter key');
        await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0code enter key');
        // Markdown cell: Press Enter to enter edit mode and type
        await notebooksPositron.selectCellAtIndex(2);
        await keyboard.press('Enter');
        await notebooksPositron.expectCellIndexToBeSelected(2, {
            isSelected: true,
            inEditMode: true
        });
        await keyboard.type('markdown enter key');
        await notebooksPositron.expectCellContentAtIndexToBe(2, 'markdown enter key### Cell 2');
    });
    (0, _test_setup_js_1.test)('Shift+Enter on last cell creates new cell and enters edit mode', async function ({ app }) {
        const { notebooksPositron } = app.workbench;
        const keyboard = app.code.driver.currentPage.keyboard;
        // Create a new notebook with 3 cells
        await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 1 });
        // Code cell: Verify pressing Shift+Enter adds a new cell below
        await notebooksPositron.selectCellAtIndex(2);
        await notebooksPositron.expectCellCountToBe(3);
        await keyboard.press('Shift+Enter');
        await notebooksPositron.expectCellCountToBe(4);
        // Verify the NEW cell (index 3) is now in edit mode with focus
        await notebooksPositron.expectCellIndexToBeSelected(3, { inEditMode: true });
        // Verify we can type immediately in the new cell
        await keyboard.type('new cell content');
        await notebooksPositron.expectCellContentAtIndexToBe(3, 'new cell content');
    });
    (0, _test_setup_js_1.test)('Move cells up and down with keyboard shortcuts', async function ({ app, r, }) {
        const { notebooksPositron } = app.workbench;
        const keyboard = app.code.driver.currentPage.keyboard;
        // Create a new notebook with 2 cells
        await notebooksPositron.newNotebook({ codeCells: 2 });
        // Enter edit mode in cell 0
        await notebooksPositron.selectCellAtIndex(0);
        await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: true });
        await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1']);
        // Test: Move cell down: Alt+Down
        await keyboard.press('Alt+ArrowDown');
        await notebooksPositron.expectCellContentsToBe(['# Cell 1', '# Cell 0']);
        // Test: Move cell up: Alt+Up
        await keyboard.press('Alt+ArrowUp');
        await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1']);
    });
    (0, _test_setup_js_1.test)('Execute and debug cells with keyboard shortcuts', async function ({ app, r, }) {
        const { notebooksPositron, debug } = app.workbench;
        const keyboard = app.code.driver.currentPage.keyboard;
        // Create a new notebook with 2 cells
        await notebooksPositron.newNotebook({ codeCells: 2 });
        await notebooksPositron.kernel.select('Python');
        // Enter edit mode in cell 0
        await notebooksPositron.selectCellAtIndex(0);
        await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: true });
        // Needs an expression to break at
        await keyboard.press('Enter');
        await keyboard.type('1 + 1');
        await app.workbench.quickaccess.runCommand('Debug: Toggle Breakpoint');
        // Test: Execute cell and select below: Shift+Enter
        await keyboard.press('Shift+Enter');
        await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }]);
        await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: false });
        // Test: Execute cell or toggle editor: Cmd+Enter
        await notebooksPositron.selectCellAtIndex(1);
        const executeShortcut = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
        await keyboard.press(executeShortcut);
        await notebooksPositron.expectExecutionOrder([{ index: 0, order: 1 }, { index: 1, order: 2 }]);
        // Test: Debug cell: Alt+Shift+Enter
        await notebooksPositron.selectCellAtIndex(0);
        await keyboard.press('Alt+Shift+Enter');
        await debug.expectDebugVariablePaneVisible();
    });
});
//# sourceMappingURL=notebook-edit-mode.test.js.map