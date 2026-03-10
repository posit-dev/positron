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
_test_setup_1.test.describe('Sessions: Accessibility', { tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.WEB, _test_setup_1.tags.ACCESSIBILITY, _test_setup_1.tags.SESSIONS, _test_setup_1.tags.CONSOLE] }, () => {
    _test_setup_1.test.beforeEach(async function ({ hotKeys }) {
        await hotKeys.closeSecondarySidebar();
    });
    _test_setup_1.test.afterEach(async function ({ sessions }) {
        await sessions.deleteDisconnectedSessions();
    });
    (0, _test_setup_1.test)('Validate session list is scrollable', async function ({ sessions }) {
        // @ts-ignore need a couple sessions for scrolling
        const [pySession, pySessionAlt] = await sessions.start(['python', 'pythonAlt']);
        // Resize window to force scrolling
        // Move the divider to be 100px above the bottom
        await sessions.setSessionDividerAboveBottom(100);
        await sessions.expectSessionListToBeScrollable({ horizontal: false, vertical: true });
        await sessions.setSessionDividerAboveBottom(500);
        // Cleaning up since next test only needs 2 sessions
        await sessions.delete(pySessionAlt.id);
    });
    (0, _test_setup_1.test)('Validate sessions are keyboard accessible', async function ({ sessions, page }) {
        const [pySession, rSession, pySession2] = await sessions.start(['python', 'r', 'python']);
        const newSessionName = 'This is a test';
        // Rename first session via keyboard actions
        await sessions.sessionTabs.first().click();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await page.keyboard.type(newSessionName);
        await page.keyboard.press('Enter');
        // Verify session name has been updated
        await sessions.expectSessionNameToBe(pySession.id, pySession.name);
        await sessions.expectSessionNameToBe(rSession.id, newSessionName);
        await sessions.expectSessionNameToBe(pySession2.id, pySession2.name);
        // Verify able to delete sessions via keyboard actions
        await sessions.expectSessionCountToBe(3);
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        await sessions.expectSessionCountToBe(2);
    });
});
//# sourceMappingURL=session-accessibility.test.js.map