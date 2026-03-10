"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const _test_setup_1 = require("../_test.setup");
const _test_setup_js_1 = require("./_test.setup.js");
_test_setup_js_1.test.use({
    suiteId: __filename
});
_test_setup_js_1.test.describe('Positron Notebooks: Search & Replace', {
    tag: [_test_setup_1.tags.POSITRON_NOTEBOOKS, _test_setup_1.tags.WEB, _test_setup_1.tags.WIN]
}, () => {
    (0, _test_setup_js_1.test)('Verify Basic Search', async function ({ app }) {
        const { notebooksPositron } = app.workbench;
        const notebookPath = path_1.default.join('workspaces', 'pokemon', 'pokemon.ipynb');
        await notebooksPositron.openNotebook(notebookPath);
        // open search and search for 'import'
        await notebooksPositron.search('import');
        await notebooksPositron.expectSearchCountToBe({ current: 1, total: 4 });
        await notebooksPositron.expectSearchDecorationCountToBe(4);
        // click next match
        await notebooksPositron.searchNext('button');
        await notebooksPositron.expectSearchCountToBe({ current: 2, total: 4 });
        // enter for next match
        await notebooksPositron.searchNext('keyboard');
        await notebooksPositron.expectSearchCountToBe({ current: 3, total: 4 });
        // click previous match
        await notebooksPositron.searchPrevious();
        await notebooksPositron.expectSearchCountToBe({ current: 2, total: 4 });
        // close search
        await notebooksPositron.searchClose('button');
        await notebooksPositron.expectSearchDecorationCountToBe(0);
    });
    (0, _test_setup_js_1.test)('Verify Replace', async function ({ app, hotKeys }) {
        const { notebooksPositron } = app.workbench;
        // create notebook with 3 code cells: "# Cell 0", "# Cell 1", "# Cell 2"
        await notebooksPositron.newNotebook({ codeCells: 3 });
        await _test_setup_js_1.test.step('Replace row starts collapsed and can be toggled', async () => {
            await notebooksPositron.search('Cell', { enterKey: false });
            await notebooksPositron.expectReplaceRowVisible(false);
            await notebooksPositron.searchExpandReplace();
            await notebooksPositron.expectReplaceRowVisible(true);
        });
        await _test_setup_js_1.test.step('Replace single match', async () => {
            await notebooksPositron.search('Cell', { replaceText: 'Replaced' });
            await notebooksPositron.expectSearchCountToBe({ current: 1, total: 2 });
            await notebooksPositron.expectCellContentsToBe(['# Replaced 0', '# Cell 1', '# Cell 2']);
        });
        await _test_setup_js_1.test.step('Undo single replace', async () => {
            // undo while search widget is still open
            await notebooksPositron.editModeAtIndex(0);
            await hotKeys.undo();
            await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
        });
        await _test_setup_js_1.test.step('Replace all matches', async () => {
            // re-open search and replace all
            await notebooksPositron.search('Cell', { replaceText: 'New', replaceAll: true });
            await notebooksPositron.expectCellContentsToBe(['# New 0', '# New 1', '# New 2']);
            await notebooksPositron.expectSearchCountToBe({ total: 0 });
        });
        await _test_setup_js_1.test.step('Undo replace all', async () => {
            // undo after closing search widget (tests both undo flows)
            await notebooksPositron.searchClose('button');
            await notebooksPositron.editModeAtIndex(0);
            await hotKeys.undo();
            await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
        });
    });
});
//# sourceMappingURL=notebook-search.test.js.map