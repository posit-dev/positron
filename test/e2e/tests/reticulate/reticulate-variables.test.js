"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
// In order to run this test on Windows, I think we need to set the env var:
// RETICULATE_PYTHON to the installed python path
_test_setup_1.test.describe('Reticulate - Variables pane support', {
    tag: [_test_setup_1.tags.RETICULATE, _test_setup_1.tags.WEB, _test_setup_1.tags.SOFT_FAIL],
}, () => {
    (0, _test_setup_1.test)('R - Verify Reticulate formats variables in the Variables pane', async function ({ app, sessions, logger }) {
        // Reticulate relies on some Positron internals to format variables in the Variables pane.
        // If the internals change it can cause reticulate variable formatting to break.
        // This allows us to learn if we regress on that functionality.
        const { console, variables } = app.workbench;
        await sessions.start('r');
        await console.pasteCodeToConsole('supported <- packageVersion("reticulate") >= "1.44.1"', true);
        await console.waitForExecutionComplete();
        try {
            await variables.expectVariableToBe('supported', 'TRUE');
        }
        catch (e) {
            // skip if not supported version
            logger.log('Reticulate version does not support variable inspection. Skipping test.');
            return;
        }
        await console.pasteCodeToConsole('np <- reticulate::import("numpy", convert = FALSE)', true);
        await console.waitForExecutionComplete();
        await console.pasteCodeToConsole('arr <- np$array(c(1L, 2L, 3L))', true);
        await console.waitForExecutionComplete();
        await variables.expectVariableToBe('np', /^<module \'numpy\' from/);
        await variables.expectVariableToBe('arr', '[1,2,3]');
    });
});
//# sourceMappingURL=reticulate-variables.test.js.map