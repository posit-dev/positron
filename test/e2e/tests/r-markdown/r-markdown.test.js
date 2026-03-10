"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('R Markdown', { tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.R_MARKDOWN, _test_setup_1.tags.ARK] }, () => {
    _test_setup_1.test.describe.configure({ mode: 'serial' }); // 2nd test depends on 1st test
    (0, _test_setup_1.test)('Verify can render R Markdown', async function ({ app, r }) {
        await app.workbench.quickaccess.openFile((0, path_1.join)(app.workspacePathOrFolder, 'workspaces', 'basic-rmd-file', 'basicRmd.rmd'));
        await app.workbench.quickaccess.runCommand('r.rmarkdownRender');
        await app.workbench.explorer.verifyExplorerFilesExist(['basicRmd.html']);
    });
    (0, _test_setup_1.test)('Verify can preview R Markdown', async function ({ app, r }) {
        await app.code.driver.currentPage.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+K' : 'Control+Shift+K');
        // inner most frame has no useful identifying features
        // not factoring this locator because its not part of positron
        const gettingStarted = app.workbench.viewer.viewerFrame.frameLocator('iframe').locator('h2[data-anchor-id="getting-started"]');
        await (0, _test_setup_1.expect)(gettingStarted).toBeVisible({ timeout: 60000 });
        await (0, _test_setup_1.expect)(gettingStarted).toHaveText('Getting started');
    });
});
//# sourceMappingURL=r-markdown.test.js.map