"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
const path_1 = require("path");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Source Content Management', {
    tag: [_test_setup_1.tags.SCM, _test_setup_1.tags.WEB, _test_setup_1.tags.WIN]
}, () => {
    _test_setup_1.test.afterAll(async function ({ cleanup }) {
        await cleanup.discardAllChanges();
    });
    (0, _test_setup_1.test)('Verify SCM Tracks File Modifications, Staging, and Commit Actions', async function ({ app, openFile }) {
        const file = 'chinook-sqlite.py';
        await _test_setup_1.test.step('Open file and add a new line to it', async () => {
            await openFile((0, path_1.join)('workspaces', 'chinook-db-py', file));
            await app.workbench.editor.clickOnTerm(file, 'rows', 9, true);
            await app.code.driver.currentPage.keyboard.press('ArrowRight');
            await app.code.driver.currentPage.keyboard.press('ArrowRight');
            await app.code.driver.currentPage.keyboard.type('\n');
            await app.code.driver.currentPage.keyboard.type('print(df)');
            await app.code.driver.currentPage.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
        });
        await _test_setup_1.test.step('Open scm viewer and await change appearance', async () => {
            await app.workbench.scm.openSCMViewlet();
            await app.workbench.scm.waitForChange(file, 'Modified');
        });
        await _test_setup_1.test.step('Open change and await tab appearance', async () => {
            await app.workbench.scm.openChange(file);
            await app.workbench.sideBar.closeSecondarySideBar();
            await app.workbench.editors.waitForSCMTab(`${file} (Working Tree)`);
            await app.workbench.layouts.enterLayout('stacked');
        });
        await _test_setup_1.test.step('Stage, commit change, and verify history', async () => {
            const message = 'Add print statement';
            await app.workbench.scm.stage(file);
            await app.workbench.scm.commit(message);
            // This works locally but not in CI where we have no
            // git user for a real commit to take place:
            // await app.workbench.scm.verifyCurrentHistoryItem(message);
        });
    });
});
//# sourceMappingURL=scm.test.js.map