"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
const _test_setup_js_1 = require("./_test.setup.js");
_test_setup_js_1.test.use({
    suiteId: __filename
});
_test_setup_js_1.test.describe('Positron Notebooks: Outline', {
    tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.WEB, _test_setup_1.tags.POSITRON_NOTEBOOKS, _test_setup_1.tags.OUTLINE]
}, () => {
    (0, _test_setup_js_1.test)('Outline displays markdown headers and code cell previews', async function ({ app }) {
        const { notebooksPositron, outline } = app.workbench;
        await _test_setup_js_1.test.step('Create notebook with markdown and code cells', async () => {
            await notebooksPositron.newNotebook();
            // Cell 0: default empty code cell
            await notebooksPositron.addCodeToCell(0, 'x = 1');
            // Cell 1: markdown with headers
            await notebooksPositron.addCell('markdown');
            await notebooksPositron.addCodeToCell(1, '# Introduction\n## Analysis');
        });
        await _test_setup_js_1.test.step('Open Outline pane and verify entries', async () => {
            await outline.focus();
            // Markdown headers should appear
            await outline.expectOutlineElementToBeVisible('Introduction');
            await outline.expectOutlineElementToBeVisible('Analysis');
            // Code cell preview should appear
            await outline.expectOutlineElementToBeVisible('x = 1');
        });
    });
    (0, _test_setup_js_1.test)('Clicking outline entries navigates to the corresponding cell', async function ({ app }) {
        const { notebooksPositron, outline } = app.workbench;
        await _test_setup_js_1.test.step('Create notebook with multiple sections', async () => {
            await notebooksPositron.newNotebook();
            // Cell 1: markdown with "# First Section"
            await notebooksPositron.addCell('markdown');
            await notebooksPositron.addCodeToCell(1, '# First Section');
            // Cell 2: code cell
            await notebooksPositron.addCell('code');
            await notebooksPositron.addCodeToCell(2, 'x = 1');
            // Cell 3: markdown with "# Second Section"
            await notebooksPositron.addCell('markdown');
            await notebooksPositron.addCodeToCell(3, '# Second Section');
        });
        await _test_setup_js_1.test.step('Click markdown header entry and verify navigation', async () => {
            await outline.focus();
            await outline.expectOutlineElementToBeVisible('Second Section');
            const secondSectionEntry = outline.outlineElement.filter({ hasText: 'Second Section' });
            await secondSectionEntry.click();
            await notebooksPositron.expectCellIndexToBeSelected(3, { isSelected: true });
        });
        await _test_setup_js_1.test.step('Click code cell entry and verify navigation', async () => {
            const codeCellEntry = outline.outlineElement.filter({ hasText: 'x = 1' });
            await codeCellEntry.click();
            await notebooksPositron.expectCellIndexToBeSelected(2, { isSelected: true });
        });
    });
});
//# sourceMappingURL=notebook-outline.test.js.map