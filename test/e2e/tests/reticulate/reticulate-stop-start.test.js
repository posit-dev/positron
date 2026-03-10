"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
const verifyReticulateFunction_js_1 = require("./helpers/verifyReticulateFunction.js");
const test_1 = require("@playwright/test");
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
    (0, _test_setup_1.test)('R - Verify Reticulate Stop/Start Functionality', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, r }) {
        const { sessions, modals } = app.workbench;
        // start new reticulate session and verify functionality
        const reticulateSession = await sessions.start('pythonReticulate');
        await modals.installIPyKernel();
        await sessions.expectSessionPickerToBe(verifyReticulateFunction_js_1.RETICULATE_SESSION, 60000);
        await (0, verifyReticulateFunction_js_1.verifyReticulateFunctionality)(app, `R ${process.env.POSITRON_R_VER_SEL}`);
        // stop reticulate session
        await sessions.select(reticulateSession.id);
        await sessions.delete(reticulateSession.id);
        // Deleting the Reticulate session will bring focus to the R session
        (0, test_1.expect)(async () => {
            const info = await sessions.getSelectedSessionInfo();
            return info.language.toLowerCase() === 'r';
        }).toPass();
        // start reticulate session (again) and verify functionality
        await sessions.start('pythonReticulate');
        await sessions.expectSessionPickerToBe(verifyReticulateFunction_js_1.RETICULATE_SESSION, 60000);
        await sessions.rename('reticulate', 'reticulateNew');
        await (0, verifyReticulateFunction_js_1.verifyReticulateFunctionality)(app, `R ${process.env.POSITRON_R_VER_SEL}`, 'reticulateNew');
    });
});
//# sourceMappingURL=reticulate-stop-start.test.js.map