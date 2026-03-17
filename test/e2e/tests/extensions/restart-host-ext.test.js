"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Restart Host Extension', {
    tag: [_test_setup_1.tags.EXTENSIONS, _test_setup_1.tags.WIN, _test_setup_1.tags.SOFT_FAIL],
    annotation: { type: 'issue', description: 'https://github.com/posit-dev/positron/issues/12476' }
}, () => {
    _test_setup_1.test.afterEach(async ({ app }) => {
        await app.workbench.sessions.deleteAll();
    });
    (0, _test_setup_1.test)('Verify Restart Extension Host command works - R', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, r }) {
        await app.workbench.quickaccess.runCommand('workbench.action.restartExtensionHost');
        await app.workbench.console.waitForConsoleContents('Extensions restarting...');
        await app.workbench.console.waitForReady('>');
        await app.workbench.console.pasteCodeToConsole('x<-1; y<-x+100; y', true);
        await app.workbench.console.waitForConsoleContents('101');
    });
    (0, _test_setup_1.test)('Verify Restart Extension Host command works - Python', async function ({ app, python }) {
        await app.workbench.quickaccess.runCommand('workbench.action.restartExtensionHost');
        await app.workbench.console.waitForConsoleContents('Extensions restarting...');
        await app.workbench.console.waitForReady('>>>');
        await app.workbench.console.pasteCodeToConsole('x=1; y=x+100; print(y)', true);
        await app.workbench.console.waitForConsoleContents('101');
    });
});
//# sourceMappingURL=restart-host-ext.test.js.map