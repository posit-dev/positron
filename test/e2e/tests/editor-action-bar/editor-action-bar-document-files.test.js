"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Editor Action Bar: Document Files
 *
 * This test suite validates the functionality of the Editor Action Bar when interacting with
 * various types of files (R Markdown, Quarto, HTML, and Jupyter Notebooks, etc.)
 *
 * Flow:
 * - Open a supported file type
 * - Interact with action bar controls to preview or split the editor
 * - Verify content is rendered or shown in a new editor/tab/window as expected
 * - Confirm expected visibility/invisibility of the action bar based on file type
 */
const test_1 = require("@playwright/test");
const _test_setup_1 = require("../_test.setup");
let editorActionBar;
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Editor Action Bar: Document Files', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.EDITOR_ACTION_BAR, _test_setup_1.tags.EDITOR]
}, () => {
    _test_setup_1.test.beforeAll(async function ({ app }) {
        editorActionBar = app.workbench.editorActionBar;
    });
    _test_setup_1.test.afterEach(async function ({ runCommand }) {
        await runCommand('workbench.action.closeAllEditors');
    });
    (0, _test_setup_1.test)('R Markdown Document - Verify `preview`, `split editor`, `open in new window` behavior', {
        tag: [_test_setup_1.tags.R_MARKDOWN]
    }, async function ({ app, openFile }) {
        await openFile('workspaces/basic-rmd-file/basicRmd.rmd');
        await verifyPreviewRendersHtml('Getting startedAnchor');
        await verifySplitEditor('basicRmd.rmd');
        await verifyOpenInNewWindow(app, 'This post examines the features');
    });
    (0, _test_setup_1.test)('Quarto Document - Verify `preview`, `split editor`, `open in new window` behavior', {
        tag: [_test_setup_1.tags.QUARTO]
    }, async function ({ app, page, openFile }) {
        await openFile('workspaces/quarto_basic/quarto_basic.qmd');
        await verifyPreviewRendersHtml('Diamond sizes');
        await verifyOpenChanges(page);
        await verifySplitEditor('quarto_basic.qmd');
        await verifyOpenInNewWindow(app, 'Diamond sizes');
    });
    (0, _test_setup_1.test)('HTML Document - Verify `open viewer`, `split editor`, `open in new window` behavior', { tag: [_test_setup_1.tags.HTML] }, async function ({ app, openFile }) {
        await openFile('workspaces/dash-py-example/data/OilandGasMetadata.html');
        await verifyOpenViewerRendersHtml(app, 'Oil, Gas, and Other Regulated');
        await verifySplitEditor('OilandGasMetadata.html');
        await verifyOpenInNewWindow(app, '<title> Oil &amp; Gas Wells - Metadata</title>');
    });
});
// Helper functions
async function verifyPreviewRendersHtml(heading) {
    // await editorActionBar.clickButton('Preview');
    await editorActionBar.verifyPreviewRendersHtml(heading);
}
async function verifySplitEditor(tabName) {
    await editorActionBar.clickButton('Split Editor Right');
    await editorActionBar.verifySplitEditor('right', tabName);
    await (0, test_1.expect)(async () => {
        await editorActionBar.clickButton('Split Editor Down');
        await editorActionBar.verifySplitEditor('down', tabName);
    }).toPass({ timeout: 30000 });
}
async function verifyOpenInNewWindow(app, text) {
    await editorActionBar.verifyOpenInNewWindow(app.web, text, false);
}
async function verifyOpenViewerRendersHtml(app, title) {
    await editorActionBar.clickButton('Open in Viewer');
    await editorActionBar.verifyOpenViewerRendersHtml(app.web, title);
}
async function verifyOpenChanges(page) {
    await _test_setup_1.test.step('verify "open changes" shows diff', async () => {
        async function bindPlatformHotkey(page, key) {
            await page.keyboard.press(process.platform === 'darwin' ? `Meta+${key}` : `Control+${key}`);
        }
        // make change & save
        await page.locator('[id="workbench\\.parts\\.editor"]').getByText('date').click();
        await page.keyboard.press('X');
        await bindPlatformHotkey(page, 'S');
        // click open changes & verify
        await editorActionBar.clickButton('Open Changes');
        await (0, test_1.expect)(page.getByLabel('Revert Block')).toBeVisible();
        await (0, test_1.expect)(page.getByLabel('Stage Block')).toBeVisible();
        await page.getByRole('tab', { name: 'quarto_basic.qmd (Working' }).getByLabel('Close').click();
        // undo changes & save
        await bindPlatformHotkey(page, 'Z');
        await bindPlatformHotkey(page, 'S');
    });
}
//# sourceMappingURL=editor-action-bar-document-files.test.js.map