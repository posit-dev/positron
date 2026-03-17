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
_test_setup_js_1.test.describe('Positron Notebooks: Cell Undo-Redo Behavior', {
    tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.WEB, _test_setup_1.tags.POSITRON_NOTEBOOKS, _test_setup_1.tags.CROSS_BROWSER]
}, () => {
    (0, _test_setup_js_1.test)('Should correctly undo and redo cell actions', async function ({ app }) {
        const { notebooksPositron } = app.workbench;
        await notebooksPositron.newNotebook({ codeCells: 2 });
        // ========================================
        // Test 1: Basic add cell and undo/redo
        // ========================================
        await _test_setup_js_1.test.step('Test 1: Add cell and undo/redo', async () => {
            // Undo the last cell operation
            await notebooksPositron.selectCellAtIndex(1, { editMode: false });
            await notebooksPositron.performCellAction('undo');
            await notebooksPositron.expectCellCountToBe(1);
            await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
            // Redo the add cell operation to add back cell
            await notebooksPositron.performCellAction('redo');
            await notebooksPositron.expectCellCountToBe(2);
            await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1']);
        });
        // ========================================
        // Test 2: Delete cell and undo/redo
        // ========================================
        await _test_setup_js_1.test.step('Test 2: Delete cell and undo/redo', async () => {
            // Add a third cell for deletion test
            await notebooksPositron.selectCellAtIndex(1, { editMode: false });
            await notebooksPositron.performCellAction('addCellBelow');
            await notebooksPositron.addCodeToCell(2, '# Cell to Delete');
            await notebooksPositron.expectCellCountToBe(3);
            // Delete the middle cell
            await notebooksPositron.selectCellAtIndex(1, { editMode: false });
            await notebooksPositron.performCellAction('delete');
            await notebooksPositron.expectCellCountToBe(2);
            await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell to Delete']);
            // Undo the delete
            await notebooksPositron.performCellAction('undo');
            await notebooksPositron.expectCellCountToBe(3);
            await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '# Cell to Delete']);
            // Redo the delete
            await notebooksPositron.performCellAction('redo');
            await notebooksPositron.expectCellCountToBe(2);
            await notebooksPositron.expectCellContentAtIndexToBe(1, '# Cell to Delete');
        });
    });
});
//# sourceMappingURL=notebook-undo-redo.test.js.map