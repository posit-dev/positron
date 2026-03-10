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
_test_setup_1.test.describe('Sessions: Delete', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.SESSIONS]
}, () => {
    (0, _test_setup_1.test)('Python - Validate can delete a single session', async function ({ sessions }) {
        await sessions.start(['python']);
        await sessions.expectSessionCountToBe(1);
        await sessions.deleteAll();
        await sessions.expectSessionCountToBe(0);
    });
    (0, _test_setup_1.test)('R - Validate can delete a single session', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ sessions }) {
        await sessions.start(['r']);
        await sessions.expectSessionCountToBe(1);
        await sessions.deleteAll();
        await sessions.expectSessionCountToBe(0);
    });
    (0, _test_setup_1.test)('Validate session picker and variables after delete', {
        tag: [_test_setup_1.tags.VARIABLES]
    }, async function ({ app, sessions }) {
        const { variables } = app.workbench;
        await sessions.deleteAll();
        // Ensure sessions exist and are idle
        const [pySession, rSession] = await sessions.start(['python', 'r']);
        // Delete 1st session and verify active sessions and runtime in session picker
        await sessions.delete(pySession.id);
        await sessions.expectSessionPickerToBe(rSession.name);
        await sessions.expectSessionCountToBe(1);
        await sessions.expectActiveSessionListsToMatch();
        await variables.expectRuntimeToBe('visible', rSession.name);
        // Delete 2nd session and verify no active sessions or runtime in session picker
        await sessions.delete(rSession.id);
        await sessions.expectSessionPickerToBe('Start Session');
        await sessions.expectSessionCountToBe(0);
        await sessions.expectActiveSessionListsToMatch();
        await variables.expectRuntimeToBe('not.visible', `${rSession.name}|${pySession.name}|None`);
    });
    (0, _test_setup_1.test)('Python & R - Validate can delete multiple sessions', async function ({ sessions }) {
        await sessions.start(['python', 'r', 'python', 'pythonAlt', 'pythonAlt', 'r', 'rAlt', 'rAlt']);
        await sessions.expectSessionCountToBe(8);
        await sessions.deleteAll();
        await sessions.expectSessionCountToBe(0);
    });
});
//# sourceMappingURL=session-delete.test.js.map