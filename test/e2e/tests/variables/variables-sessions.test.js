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
_test_setup_1.test.describe('Variables: Sessions', {
    tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.WEB, _test_setup_1.tags.CRITICAL, _test_setup_1.tags.VARIABLES, _test_setup_1.tags.SESSIONS]
}, () => {
    _test_setup_1.test.beforeEach(async function ({ hotKeys }) {
        await hotKeys.closeSecondarySidebar();
    });
    _test_setup_1.test.afterEach(async function ({ sessions }) {
        await sessions.deleteDisconnectedSessions();
    });
    (0, _test_setup_1.test)('Validate variables are isolated between sessions', async function ({ app, sessions }) {
        const { console, variables } = app.workbench;
        // Ensure sessions exist and are idle
        const [pySession, pySessionAlt, rSession] = await sessions.start(['python', 'pythonAlt', 'r']);
        // Set and verify variables in Python Session 1
        await sessions.select(pySession.id);
        await console.typeToConsole('x = 1', true);
        await console.typeToConsole('y = 2', true);
        await variables.expectRuntimeToBe('visible', pySession.name);
        await variables.expectVariableToBe('x', '1');
        await variables.expectVariableToBe('y', '2');
        // Set and verify variables in Python Session 2
        await sessions.select(pySessionAlt.id);
        await console.typeToConsole('x = 11', true);
        await console.typeToConsole('y = 22', true);
        await variables.expectRuntimeToBe('visible', pySessionAlt.name);
        await variables.expectVariableToBe('x', '11');
        await variables.expectVariableToBe('y', '22');
        // Set and verify variables in R
        await sessions.select(rSession.id);
        await console.typeToConsole('x <- 3', true);
        await console.typeToConsole('z <- 4', true);
        await variables.expectRuntimeToBe('visible', rSession.name);
        await variables.expectVariableToBe('x', '3');
        await variables.expectVariableToBe('z', '4');
        // Switch back to Python, update variables, and verify
        await sessions.select(pySession.id);
        await console.typeToConsole('x = 0', true);
        await variables.expectRuntimeToBe('visible', pySession.name);
        await variables.expectVariableToBe('x', '0');
        await variables.expectVariableToBe('y', '2');
        // Switch back to R, verify variables remain unchanged
        await sessions.select(rSession.id);
        await variables.expectRuntimeToBe('visible', rSession.name);
        await variables.expectVariableToBe('x', '3');
        await variables.expectVariableToBe('z', '4');
    });
});
//# sourceMappingURL=variables-sessions.test.js.map