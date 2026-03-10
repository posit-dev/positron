"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
const verifyReticulateFunction_js_1 = require("./helpers/verifyReticulateFunction.js");
_test_setup_1.test.use({
    suiteId: __filename
});
// In order to run this test on Windows, I think we need to set the env var:
// RETICULATE_PYTHON
// to the installed python path
_test_setup_1.test.describe('Reticulate', {
    tag: [_test_setup_1.tags.RETICULATE, _test_setup_1.tags.WEB, _test_setup_1.tags.ARK, _test_setup_1.tags.SOFT_FAIL],
}, () => {
    _test_setup_1.test.beforeAll(async function ({ app, settings }) {
        try {
            await settings.set({
                'positron.reticulate.enabled': true,
                'kernelSupervisor.transport': 'tcp'
            }, { reload: true });
        }
        catch (e) {
            await app.code.driver.takeScreenshot('reticulateSetup');
            throw e;
        }
    });
    (0, _test_setup_1.test)('R - Verify Basic Reticulate Functionality using reticulate::repl_python() with multiple sessions', async function ({ app, sessions, logger }) {
        const { console } = app.workbench;
        // start R session and start reticulate within it
        const rSessionMetaData = await sessions.start('r');
        await console.pasteCodeToConsole('reticulate::repl_python()', true);
        await console.waitForReadyAndStarted('>>>');
        // rename reticulate session to: sessionOne and verify functionality
        await sessions.rename('reticulate', 'sessionOne');
        await (0, verifyReticulateFunction_js_1.verifyReticulateFunctionality)(app, rSessionMetaData.id, 'sessionOne');
        // start a second R session and start reticulate within it
        const rSessionMetaData2 = await sessions.start('r', { reuse: false });
        await console.pasteCodeToConsole('reticulate::repl_python()', true);
        await console.waitForReadyAndStarted('>>>');
        // rename reticulate session to: sessionTwo and verify functionality
        await sessions.rename('reticulate', 'sessionTwo');
        await (0, verifyReticulateFunction_js_1.verifyReticulateFunctionality)(app, rSessionMetaData2.id, 'sessionTwo', '300', '500', '7');
    });
});
//# sourceMappingURL=reticulate-multiple.test.js.map