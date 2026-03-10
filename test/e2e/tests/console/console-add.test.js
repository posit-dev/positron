"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Console: Add +', {
    tag: [_test_setup_1.tags.SESSIONS, _test_setup_1.tags.CONSOLE, _test_setup_1.tags.WEB, _test_setup_1.tags.WIN]
}, () => {
    (0, _test_setup_1.test)('Validate can duplicate runtime via Console + button', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, page }) {
        const { sessions, console } = app.workbench;
        await sessions.start(['r']);
        // Click the `+` button in the console to add a new session of the same type
        await console.clickDuplicateSessionButton();
        await (0, test_1.expect)(page.getByTestId(/console-tab-r-*/)).toHaveCount(2);
        await sessions.expectAllSessionsToBeReady();
    });
    (0, _test_setup_1.test)('Validate can start a different runtime via Console + button', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, page }) {
        const { sessions, console } = app.workbench;
        await sessions.start(['r', 'r']);
        // Click the `+ v` button in the console to Start Another session
        await console.clickStartAnotherSessionButton('python');
        await (0, test_1.expect)(page.getByTestId(/console-tab-r-*/)).toHaveCount(2);
        await (0, test_1.expect)(page.getByTestId(/console-tab-python-*/)).toHaveCount(1);
        await sessions.expectAllSessionsToBeReady();
    });
    (0, _test_setup_1.test)('Validate Console + button menu shows both active and disconnected sessions', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app }) {
        const { sessions, console } = app.workbench;
        const [pythonSession, rSession] = await sessions.start(['python', 'r', 'r', 'r', 'r', 'r', 'r',]);
        // Verify the Python and R sessions are listed in the console `+` menu
        await console.expectSessionContextMenuToContain([
            { label: rSession.name }, { label: pythonSession.name }
        ]);
        // Disconnect the R session
        await sessions.select(rSession.id);
        await console.pasteCodeToConsole('q()', true);
        await sessions.expectStatusToBe(rSession.id, 'disconnected');
        // Disconnect the Python session
        await sessions.select(pythonSession.id);
        await console.pasteCodeToConsole('exit()', true);
        await sessions.expectStatusToBe(pythonSession.id, 'disconnected');
        // Verify the disconnected sessions are still in the console `+` menu
        await console.expectSessionContextMenuToContain([
            { label: rSession.name }, { label: pythonSession.name }
        ]);
    });
});
//# sourceMappingURL=console-add.test.js.map