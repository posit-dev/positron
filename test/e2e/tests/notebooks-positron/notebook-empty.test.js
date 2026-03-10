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
_test_setup_js_1.test.describe('Notebook: Empty State Behavior', {
    tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.WEB, _test_setup_1.tags.POSITRON_NOTEBOOKS]
}, () => {
    (0, _test_setup_js_1.test)('Can delete all, undo, redo on empty notebook', async function ({ app }) {
        const { notebooksPositron } = app.workbench;
        const keyboard = app.code.driver.currentPage.keyboard;
        // create a new notebook with 2 code cells and 2 markdown cells
        await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 2 });
        // Delete all cells via multiselect
        await notebooksPositron.selectCellAtIndex(0, { editMode: false });
        await keyboard.press('Shift+ArrowDown');
        await keyboard.press('Shift+ArrowDown');
        await keyboard.press('Shift+ArrowDown'); // all 4 cells selected
        await notebooksPositron.performCellAction('delete');
        await notebooksPositron.expectCellCountToBe(0);
        // Ensure can undo to restore cells
        await notebooksPositron.performCellAction('undo');
        await notebooksPositron.expectCellCountToBe(4);
        await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '### Cell 2', '### Cell 3']);
        // Ensure can redo to delete cells again
        await notebooksPositron.performCellAction('redo');
        await notebooksPositron.expectCellCountToBe(0);
    });
    (0, _test_setup_js_1.test)('Can cut/paste on empty notebook', async function ({ app }) {
        const { notebooksPositron } = app.workbench;
        const keyboard = app.code.driver.currentPage.keyboard;
        // create a new notebook with 2 code cells and 2 markdown cells
        await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 2 });
        // Cut all cells via multiselect
        await notebooksPositron.selectCellAtIndex(0, { editMode: false });
        await keyboard.press('Shift+ArrowDown');
        await keyboard.press('Shift+ArrowDown');
        await keyboard.press('Shift+ArrowDown'); // all 4 cells selected
        await notebooksPositron.performCellAction('cut');
        await notebooksPositron.expectCellCountToBe(0);
        // Paste into empty notebook
        await notebooksPositron.performCellAction('paste');
        await notebooksPositron.expectCellCountToBe(4);
        await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '### Cell 2', '### Cell 3']);
        // Undo the paste
        await notebooksPositron.performCellAction('undo');
        await notebooksPositron.expectCellCountToBe(0);
        // Redo the paste
        await notebooksPositron.performCellAction('redo');
        await notebooksPositron.expectCellCountToBe(4);
        await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '### Cell 2', '### Cell 3']);
    });
});
//# sourceMappingURL=notebook-empty.test.js.map