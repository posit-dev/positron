"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
const playwrightDriver_js_1 = require("../../infra/playwrightDriver.js");
_test_setup_1.test.use({
    suiteId: __filename
});
// Added this test in https://github.com/posit-dev/positron/pull/11006, but skipping
// as the assert at the end is failing in CI but passing locally - likely due to newline differences
_test_setup_1.test.describe.skip('Copy from Output and paste to Editor', { tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.OUTPUT, _test_setup_1.tags.EDITOR] }, () => {
    (0, _test_setup_1.test)('Copy Window output log content to editor', async function ({ app, page }) {
        const { editors, layouts, output, quickaccess } = app.workbench;
        // Step 1: Maximize the panel so it's easier to copy text
        await layouts.enterLayout('fullSizedPanel');
        // Step 2: Open the Window output
        await output.openOutputPane('Window');
        // Step 3: Scroll to the top of the Window output pane and select the first 15 lines
        (0, playwrightDriver_js_1.wait)(500); // wait for output to render
        await output.scrollToTop();
        await output.selectFirstNLines(15);
        // Step 4: Cmd/Ctrl + C to copy
        const copiedText = await output.copySelectedText();
        // Step 5: Minimize the panel so that the editor space is maximized
        await quickaccess.runCommand('workbench.action.minimizePanel');
        // Step 6: Open a new untitled file in the editor
        await editors.newUntitledFile();
        // Step 7: Paste the text into the editor
        const isMac = process.platform === 'darwin';
        const modifier = isMac ? 'Meta' : 'Control';
        await page.keyboard.press(`${modifier}+V`);
        // Step 8: Check if the editor contains the copied text
        // TODO: this assertion is failing in CI but passing locally - likely due to newline differences
        await editors.expectEditorToContain(copiedText);
    });
});
//# sourceMappingURL=output-to-editor-copy.test.js.map