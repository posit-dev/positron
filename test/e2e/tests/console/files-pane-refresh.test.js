"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
// Simple Test: Files Pane Refresh
// Description: Verify that the Files pane refreshes after creating a file via the console.
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Files Pane Refresh', { tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WORKBENCH, _test_setup_1.tags.CONSOLE] }, () => {
    _test_setup_1.test.afterAll(async ({ cleanup }) => {
        await cleanup.removeTestFiles(['file.txt']);
    });
    (0, _test_setup_1.test)('Files pane refreshes after creating file.txt via console', async function ({ app, r }) {
        const { console, explorer } = app.workbench;
        await console.createFile('R', 'file.txt');
        await explorer.verifyExplorerFilesExist(['file.txt']);
    });
});
//# sourceMappingURL=files-pane-refresh.test.js.map