"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_js_1 = require("../_test.setup.js");
_test_setup_js_1.test.use({
    suiteId: __filename
});
_test_setup_js_1.test.describe('Diagnostics', {
    tag: [_test_setup_js_1.tags.SESSIONS, _test_setup_js_1.tags.PROBLEMS, _test_setup_js_1.tags.WEB, _test_setup_js_1.tags.WIN, _test_setup_js_1.tags.SOFT_FAIL],
}, () => {
    _test_setup_js_1.test.afterEach(async function ({ runCommand }) {
        await runCommand('workbench.action.closeAllEditors');
    });
    (0, _test_setup_js_1.test)('R - Verify diagnostics isolation between sessions in the editor and problems view', {
        tag: [_test_setup_js_1.tags.ARK]
    }, async function ({ app, runCommand, sessions }) {
        const { problems, editor, console } = app.workbench;
        // Start R Session and define variable
        const rSession = await sessions.start('r');
        await console.pasteCodeToConsole('unlikelyvariablename <- 1', true);
        // Open new R file and use variable
        await runCommand('R: New File');
        await editor.type('unlikelyvariablename\n');
        // Session 1 - verify no problems
        await problems.expectDiagnosticsToBe({ badgeCount: 0, warningCount: 0, errorCount: 0 });
        await problems.expectSquigglyCountToBe('warning', 0);
        // Start R Session 2 - verify warning since variable is not defined
        const rSessionAlt = await sessions.start('rAlt');
        await problems.expectSquigglyCountToBe('warning', 1);
        await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 1, errorCount: 0 });
        await problems.expectWarningText('No symbol named \'unlikelyvariablename');
        // Introduce a syntax error
        await editor.selectTabAndType('Untitled-1', 'x <-');
        // Session 2 - verify both problems (variable and syntax) are present
        await sessions.select(rSessionAlt.id);
        await problems.expectDiagnosticsToBe({ badgeCount: 2, warningCount: 1, errorCount: 1 });
        await problems.expectSquigglyCountToBe('error', 1);
        // Session 1 - verify only syntax error is present
        await sessions.select(rSession.id);
        await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 0, errorCount: 1 });
        await problems.expectSquigglyCountToBe('error', 1);
        // Session 1 - restart session and verify both problems (variable and syntax) are present
        // Diagnostics engine is not aware of the defined variable, this is expected
        await sessions.restart(rSession.id);
        await problems.expectDiagnosticsToBe({ badgeCount: 2, warningCount: 1, errorCount: 1 });
        await problems.expectSquigglyCountToBe('error', 1);
    });
});
//# sourceMappingURL=diagnostics.test.js.map