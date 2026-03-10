"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Python Debugging', {
    tag: [_test_setup_1.tags.DEBUG, _test_setup_1.tags.WEB, _test_setup_1.tags.WIN]
}, () => {
    _test_setup_1.test.afterAll(async function ({ cleanup }) {
        await cleanup.discardAllChanges();
    });
    (0, _test_setup_1.test)('Python - Verify Module Auto Reload', async function ({ app, python, openFile, hotKeys }) {
        await _test_setup_1.test.step('Open file, run, validate ouput', async () => {
            await openFile((0, path_1.join)('workspaces', 'python_module_caching', 'app.py'));
            await app.workbench.editor.pressPlay(true);
            await app.workbench.console.waitForConsoleContents('Hello World');
        });
        const helperFile = 'helper_functions.py';
        await _test_setup_1.test.step('Edit helper', async () => {
            await openFile((0, path_1.join)('workspaces', 'python_module_caching', 'helper', helperFile));
            await app.workbench.editor.replaceTerm(helperFile, '"Hello', 2, 'Goodbye');
            await hotKeys.save();
        });
        await _test_setup_1.test.step('Re-run with edited helper', async () => {
            await openFile((0, path_1.join)('workspaces', 'python_module_caching', 'app.py'));
            await app.workbench.editor.pressPlay(true);
            await app.workbench.console.waitForConsoleContents('Goodbye World');
        });
    });
});
//# sourceMappingURL=python-module-loading.test.js.map