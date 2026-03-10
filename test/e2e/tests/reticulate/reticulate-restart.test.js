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
    tag: [_test_setup_1.tags.RETICULATE, _test_setup_1.tags.WEB, _test_setup_1.tags.SOFT_FAIL],
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
    (0, _test_setup_1.test)('R - Verify Reticulate Restart', {
        tag: [_test_setup_1.tags.RETICULATE, _test_setup_1.tags.CONSOLE]
    }, async function ({ sessions }) {
        // start new reticulate session
        await sessions.start('pythonReticulate');
        await sessions.expectSessionPickerToBe(verifyReticulateFunction_js_1.RETICULATE_SESSION, 60000);
        await sessions.expectStatusToBe(verifyReticulateFunction_js_1.RETICULATE_SESSION, 'idle');
        // restart reticulate session
        await sessions.restart(verifyReticulateFunction_js_1.RETICULATE_SESSION, {
            clearConsole: true,
            waitForIdle: true,
            clickModalButton: 'Yes'
        });
        await sessions.expectAllSessionsToBeReady();
    });
});
//# sourceMappingURL=reticulate-restart.test.js.map