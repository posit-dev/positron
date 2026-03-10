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
_test_setup_js_1.test.describe('Notebook: Delete', {
    tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.WEB, _test_setup_1.tags.POSITRON_NOTEBOOKS]
}, () => {
    (0, _test_setup_js_1.test)('Delete single cell moves focus to correct cell', async function ({ app }) {
        const { notebooksPositron } = app.workbench;
        // create a new notebook with 2 code cells and 2 markdown cells
        await notebooksPositron.newNotebook({ codeCells: 2, markdownCells: 2 });
        // delete from top/middle moves focus down to next cell
        await notebooksPositron.selectCellAtIndex(2, { editMode: false });
        await notebooksPositron.performCellAction('delete');
        await notebooksPositron.expectCellCountToBe(3);
        await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1', '### Cell 3']);
        await notebooksPositron.expectCellIndexToBeSelected(2, { inEditMode: false });
        // delete from bottom moves focus up to previous cell
        await notebooksPositron.selectCellAtIndex(2, { editMode: false });
        await notebooksPositron.performCellAction('delete');
        await notebooksPositron.expectCellCountToBe(2);
        await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 1']);
        await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: false });
    });
    (0, _test_setup_js_1.test)('Delete multiple selected cells moves focus to correct cell', async function ({ app }) {
        const { notebooksPositron } = app.workbench;
        const keyboard = app.code.driver.currentPage.keyboard;
        // create a new notebook with 8 code cells
        await notebooksPositron.newNotebook({ codeCells: 8 });
        // Multiselect and delete cells in middle
        await notebooksPositron.selectCellAtIndex(1, { editMode: false });
        await keyboard.press('Shift+ArrowDown');
        await keyboard.press('Shift+ArrowDown'); // cells at index 1,2,3 selected
        await notebooksPositron.performCellAction('delete');
        await notebooksPositron.expectCellCountToBe(5);
        await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 4', '# Cell 5', '# Cell 6', '# Cell 7']);
        await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: false });
        // Multiselect and delete multiple cells at end
        await notebooksPositron.selectCellAtIndex(4, { editMode: false });
        await keyboard.press('Shift+ArrowUp');
        await keyboard.press('Shift+ArrowUp');
        await notebooksPositron.performCellAction('delete'); // cells at index 2,3,4 selected
        await notebooksPositron.expectCellCountToBe(2);
        await notebooksPositron.expectCellContentsToBe(['# Cell 0', '# Cell 4']);
        await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: false });
    });
});
//# sourceMappingURL=notebook-delete.test.js.map