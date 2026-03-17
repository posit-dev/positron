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
_test_setup_1.test.describe('Variables - Filters', { tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.VARIABLES, _test_setup_1.tags.CROSS_BROWSER] }, () => {
    _test_setup_1.test.afterEach(async function ({ app }) {
        await app.workbench.layouts.enterLayout('stacked');
    });
    (0, _test_setup_1.test)('Setting filter text is reflected in the variables pane', async function ({ app, sessions }) {
        const { layouts, console, variables } = app.workbench;
        await layouts.enterLayout('fullSizedAuxBar');
        // Start R and set some variables in R and verify they are present
        await sessions.start('r');
        await console.executeCode('R', 'hello <- 1; foo <- 2');
        await variables.expectVariableToBe('hello', '1');
        await variables.expectVariableToBe('foo', '2');
        // Set a filter and verify that only the filtered variable is present
        await variables.setFilterText('hello');
        await variables.expectVariableToBe('hello', '1');
        await variables.expectVariableToNotExist('foo');
        // Start Python and verify that the filter is cleared and all variables are present
        await sessions.start('python');
        await console.executeCode('Python', 'hello = 1; foo = 2');
        await variables.expectVariableToBe('hello', '1');
        await variables.expectVariableToBe('foo', '2');
        // Set a filter and verify that only the filtered variable is present
        await variables.setFilterText('foo');
        await variables.expectVariableToBe('foo', '2');
        await variables.expectVariableToNotExist('hello');
    });
});
//# sourceMappingURL=variables-filter.test.js.map