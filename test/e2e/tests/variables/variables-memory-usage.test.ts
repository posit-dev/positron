/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Variables: Memory Usage', {
	tag: [tags.WIN, tags.VARIABLES, tags.SESSIONS]
}, () => {

	test.beforeEach(async function ({ hotKeys }) {
		await hotKeys.closeSecondarySidebar();
	});

	test.afterEach(async function ({ sessions }) {
		await sessions.deleteDisconnectedSessions();
	});

	test('Shut-down session is removed from memory usage meter', { tag: [tags.WEB] }, async function ({ app, sessions, settings }) {
		const { console, variables } = app.workbench;

		// Set a fast polling interval so the memory meter updates quickly
		await settings.set({ 'positron.memoryUsage.pollingIntervalMs': 1000 });

		// Start two sessions
		const [pySession, rSession] = await sessions.start(['python', 'r']);

		// Wait for the memory meter to be ready
		await variables.expectMemoryMeterReady();

		// Verify both sessions appear in the dropdown
		await variables.openMemoryDropdown();
		await variables.expectSessionInMemoryDropdown(pySession.name, true);
		await variables.expectSessionInMemoryDropdown(rSession.name, true);
		await variables.closeMemoryDropdown();

		// Shut down the Python session (not delete)
		await sessions.select(pySession.name);
		await console.typeToConsole('exit()', true);
		await sessions.expectSessionCountToBe(1, 'active');

		// Switch to the R session so the variables pane is active
		await sessions.select(rSession.name);
		await variables.expectMemoryMeterReady();

		// Verify the shut-down Python session is no longer listed
		await variables.openMemoryDropdown();
		await variables.expectSessionInMemoryDropdown(pySession.name, false);
		await variables.expectSessionInMemoryDropdown(rSession.name, true);
		await variables.closeMemoryDropdown();
	});

	test('Reconnected session reappears in memory usage meter after extension host restart', async function ({ app, sessions, settings }) {
		const { console: consolePage, quickaccess, variables } = app.workbench;

		// Set a fast polling interval so the memory meter updates quickly
		await settings.set({ 'positron.memoryUsage.pollingIntervalMs': 1000 });

		// Start an R session
		const [rSession] = await sessions.start(['r']);

		// Wait for the memory meter to be ready
		await variables.expectMemoryMeterReady();

		// Open the dropdown and verify the session appears
		await variables.openMemoryDropdown();
		await variables.expectSessionInMemoryDropdown(rSession.name, true);
		await variables.closeMemoryDropdown();

		// Restart the extension host
		await quickaccess.runCommand('workbench.action.restartExtensionHost');
		await consolePage.waitForConsoleContents('Extensions restarting...');
		await consolePage.waitForReady('>');

		// Wait for memory meter to be ready after reconnection
		await variables.expectMemoryMeterReady();

		// Open the dropdown and verify the session reappears after extension host restart
		await variables.openMemoryDropdown();
		await variables.expectSessionInMemoryDropdown(rSession.name, true);
		await variables.closeMemoryDropdown();
	});

	test('Restarted session reappears in memory usage meter', { tag: [tags.WEB] }, async function ({ app, sessions, settings }) {
		const { variables } = app.workbench;

		// Set a fast polling interval so the memory meter updates quickly
		await settings.set({ 'positron.memoryUsage.pollingIntervalMs': 1000 });

		// Start a Python session
		const [pySession] = await sessions.start(['python']);

		// Wait for the memory meter to be ready
		await variables.expectMemoryMeterReady();

		// Open the dropdown and verify the session appears
		await variables.openMemoryDropdown();
		await variables.expectSessionInMemoryDropdown(pySession.name, true);
		await variables.closeMemoryDropdown();

		// Restart the session
		await sessions.restart(pySession.name);

		// Wait for memory meter to be ready after restart
		await variables.expectMemoryMeterReady();

		// Open the dropdown and verify the session still appears after restart
		await variables.openMemoryDropdown();
		await variables.expectSessionInMemoryDropdown(pySession.name, true);
		await variables.closeMemoryDropdown();
	});
});
