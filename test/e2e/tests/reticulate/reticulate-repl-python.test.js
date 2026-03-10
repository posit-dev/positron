"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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
    (0, _test_setup_1.test)('R - Verify Basic Reticulate Functionality using reticulate::repl_python()', async function ({ app, sessions, logger }) {
        const { console } = app.workbench;
        // start new reticulate session and verify functionality
        const rSessionMetaData = await sessions.start('r');
        await console.pasteCodeToConsole('reticulate::repl_python()', true);
        await console.waitForReadyAndStarted('>>>');
        await (0, verifyReticulateFunction_js_1.verifyReticulateFunctionality)(app, rSessionMetaData.id);
    });
});
//# sourceMappingURL=reticulate-repl-python.test.js.map