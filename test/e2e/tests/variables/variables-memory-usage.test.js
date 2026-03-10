"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Variables: Memory Usage', {
    tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.VARIABLES, _test_setup_1.tags.SESSIONS]
}, () => {
    _test_setup_1.test.beforeEach(async function ({ hotKeys }) {
        await hotKeys.closeSecondarySidebar();
    });
    _test_setup_1.test.afterEach(async function ({ sessions }) {
        await sessions.deleteDisconnectedSessions();
    });
    (0, _test_setup_1.test)('Shut-down session is removed from memory usage meter', { tag: [_test_setup_1.tags.WEB] }, async function ({ app, sessions, settings }) {
        const { console, variables } = app.workbench;
        // Set a fast polling interval so the memory meter updates quickly
        await settings.set({ 'positron.memoryUsage.pollingIntervalMs': 1000 });
        // Start two sessions
        const [pySession, rSession] = await sessions.start(['python', 'r']);
        // Wait for the memory meter to be ready
        await variables.expectMemoryMeterReady();
        // Verify both sessions appear in the dropdown
        await variables.expectSessionsInMemoryDropdown({
            [pySession.name]: true,
            [rSession.name]: true
        });
        // Shut down the Python session (not delete)
        await sessions.select(pySession.name);
        await console.typeToConsole('exit()', true);
        await sessions.expectSessionCountToBe(1, 'active');
        // Switch to the R session so the variables pane is active
        await sessions.select(rSession.name);
        await variables.expectMemoryMeterReady();
        // Verify the shut-down Python session is no longer listed
        await variables.expectSessionsInMemoryDropdown({
            [pySession.name]: false,
            [rSession.name]: true
        });
    });
    (0, _test_setup_1.test)('Reconnected session reappears in memory usage meter after extension host restart', async function ({ app, sessions, settings }) {
        const { console: consolePage, quickaccess, variables } = app.workbench;
        // Set a fast polling interval so the memory meter updates quickly
        await settings.set({ 'positron.memoryUsage.pollingIntervalMs': 1000 });
        // Start an R session
        const [rSession] = await sessions.start(['r']);
        // Wait for the memory meter to be ready
        await variables.expectMemoryMeterReady();
        // Verify the session appears in the dropdown
        await variables.expectSessionsInMemoryDropdown({ [rSession.name]: true });
        // Restart the extension host
        await quickaccess.runCommand('workbench.action.restartExtensionHost');
        await consolePage.waitForConsoleContents('Extensions restarting...');
        await consolePage.waitForReady('>');
        // Wait for memory meter to be ready after reconnection
        await variables.expectMemoryMeterReady();
        // Verify the session reappears after extension host restart
        await variables.expectSessionsInMemoryDropdown({ [rSession.name]: true });
    });
    (0, _test_setup_1.test)('Restarted session reappears in memory usage meter', { tag: [_test_setup_1.tags.WEB] }, async function ({ app, sessions, settings }) {
        const { variables } = app.workbench;
        // Set a fast polling interval so the memory meter updates quickly
        await settings.set({ 'positron.memoryUsage.pollingIntervalMs': 1000 });
        // Start a Python session
        const [pySession] = await sessions.start(['python']);
        // Wait for the memory meter to be ready
        await variables.expectMemoryMeterReady();
        // Verify the session appears in the dropdown
        await variables.expectSessionsInMemoryDropdown({ [pySession.name]: true });
        // Restart the session
        await sessions.restart(pySession.name);
        // Wait for memory meter to be ready after restart
        await variables.expectMemoryMeterReady();
        // Verify the session still appears after restart
        await variables.expectSessionsInMemoryDropdown({ [pySession.name]: true });
    });
});
//# sourceMappingURL=variables-memory-usage.test.js.map