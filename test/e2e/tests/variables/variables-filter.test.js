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
_test_setup_1.test.describe('Variables - Filters', { tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.VARIABLES] }, () => {
    _test_setup_1.test.afterEach(async function ({ app }) {
        await app.workbench.layouts.enterLayout('stacked');
    });
    (0, _test_setup_1.test)('Setting filter text is reflected in the variables pane', async function ({ app, sessions }) {
        await sessions.start('r');
        await app.workbench.layouts.enterLayout('fullSizedAuxBar');
        await app.workbench.console.pasteCodeToConsole('hello <- 1; foo <- 2', true);
        const variables = app.workbench.variables;
        await (0, _test_setup_1.expect)(async () => {
            const vars = await variables.getFlatVariables();
            (0, _test_setup_1.expect)(vars.has('hello')).toBe(true);
            (0, _test_setup_1.expect)(vars.has('foo')).toBe(true);
        }).toPass({ timeout: 20000 });
        await variables.setFilterText('hello');
        await app.code.wait(1000); // a little time for the filter to be applied
        await (0, _test_setup_1.expect)(async () => {
            try {
                const vars = await variables.getFlatVariables();
                (0, _test_setup_1.expect)(vars.has('hello')).toBe(true);
                (0, _test_setup_1.expect)(vars.has('foo')).toBe(false);
            }
            catch (e) {
                await app.code.wait(1000); // a little time for the filter to be applied
                throw e;
            }
        }).toPass({ timeout: 40000 });
        await sessions.start('python');
        await app.workbench.console.pasteCodeToConsole('hello = 1; foo = 2', true);
        await (0, _test_setup_1.expect)(async () => {
            const vars = await variables.getFlatVariables();
            (0, _test_setup_1.expect)(vars.has('hello')).toBe(true);
            (0, _test_setup_1.expect)(vars.has('foo')).toBe(true);
        }).toPass({ timeout: 20000 });
        await variables.setFilterText('foo');
        await app.code.wait(1000); // a little time for the filter to be applied
        await (0, _test_setup_1.expect)(async () => {
            try {
                const vars = await variables.getFlatVariables();
                (0, _test_setup_1.expect)(vars.has('hello')).toBe(false);
                (0, _test_setup_1.expect)(vars.has('foo')).toBe(true);
            }
            catch (e) {
                await app.code.wait(1000); // a little time for the filter to be applied
                throw e;
            }
        }).toPass({ timeout: 40000 });
    });
});
//# sourceMappingURL=variables-filter.test.js.map