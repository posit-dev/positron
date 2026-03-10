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
const FILENAME = 'fast-execution.r';
_test_setup_1.test.describe('R Fast Execution', { tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.EDITOR, _test_setup_1.tags.WIN] }, () => {
    (0, _test_setup_1.test)('Verify fast execution is not out of order', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, r }) {
        await app.workbench.quickaccess.openFile((0, path_1.join)(app.workspacePathOrFolder, 'workspaces', 'fast-statement-execution', FILENAME));
        let previousTop = -1;
        // Note that this outer loop iterates 10 times.  This is because the length of the
        // file fast-execution.r is 10 lines.  We want to be sure to send a Control+Enter
        // for every line of the file
        for (let i = 0; i < 10; i++) {
            let currentTop = await app.workbench.editor.getCurrentLineTop();
            let retries = 20;
            // Note that top is a measurement of the distance from the top of the editor
            // to the top of the current line.  By monitoring the top value, we can determine
            // if the editor is advancing to the next line.  Without this check, the test
            // would send Control+Enter many times to the first line of the file and not
            // perform the desired test.
            while (currentTop === previousTop && retries > 0) {
                currentTop = await app.workbench.editor.getCurrentLineTop();
                retries--;
            }
            previousTop = currentTop;
            await app.code.driver.currentPage.keyboard.press('Control+Enter');
        }
        await app.workbench.variables.waitForVariableRow('c');
        await app.workbench.layouts.enterLayout('fullSizedAuxBar');
        const variablesMap = await app.workbench.variables.getFlatVariables();
        (0, _test_setup_1.expect)(variablesMap.get('x')).toStrictEqual({ value: '1', type: 'dbl' });
        (0, _test_setup_1.expect)(variablesMap.get('y')).toStrictEqual({ value: '1', type: 'dbl' });
        (0, _test_setup_1.expect)(variablesMap.get('z')).toStrictEqual({ value: '1', type: 'dbl' });
        (0, _test_setup_1.expect)(variablesMap.get('a')).toStrictEqual({ value: '1', type: 'dbl' });
        (0, _test_setup_1.expect)(variablesMap.get('b')).toStrictEqual({ value: '1', type: 'dbl' });
        (0, _test_setup_1.expect)(variablesMap.get('c')).toStrictEqual({ value: '1', type: 'dbl' });
    });
});
//# sourceMappingURL=fast-execution.test.js.map