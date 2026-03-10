"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const _test_setup_1 = require("../_test.setup");
const path_1 = require("path");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('References', {
    tag: [_test_setup_1.tags.REFERENCES, _test_setup_1.tags.WEB, _test_setup_1.tags.WIN]
}, () => {
    _test_setup_1.test.afterEach(async ({ app, runCommand }) => {
        await app.workbench.references.close();
        await runCommand('workbench.action.closeAllEditors');
    });
    (0, _test_setup_1.test)('R - Verify References Pane Lists All Function References Across Files', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, r, openFile }) {
        const helper = 'helper.R';
        await openFile((0, path_1.join)('workspaces', 'references_tests', 'r', helper));
        await openAndCommonValidations(app, helper);
        await _test_setup_1.test.step('Verify reference files', async () => {
            await app.workbench.references.waitForReferenceFiles(['main.R', 'another_script.R', helper]);
        });
    });
});
async function openAndCommonValidations(app, helper) {
    await (0, test_1.expect)(async () => {
        await app.workbench.editor.clickOnTerm(helper, 'add', 1, true);
        await _test_setup_1.test.step('Open references view', async () => {
            await app.code.driver.currentPage.keyboard.press('Shift+F12');
            await app.workbench.references.waitUntilOpen();
        });
    }).toPass({ timeout: 60000 });
    await _test_setup_1.test.step('Verify title references count', async () => {
        await app.workbench.sideBar.closeSecondarySideBar();
        await app.workbench.references.waitForReferencesCountInTitle(4);
        await app.workbench.layouts.enterLayout('stacked');
    });
    await _test_setup_1.test.step('Verify references count', async () => {
        await app.workbench.references.waitForReferencesCount(1);
    });
    await _test_setup_1.test.step('Verify references file', async () => {
        await app.workbench.references.waitForFile(helper);
    });
}
//# sourceMappingURL=references.test.js.map