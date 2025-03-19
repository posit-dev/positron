/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Sessions: State', {
	tag: [tags.WIN, tags.WEB, tags.CONSOLE, tags.SESSIONS]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test.beforeEach(async function ({ app }) {
		await app.workbench.variables.togglePane('hide');
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.sessions.deleteDisconnectedSessions();
	});

	test('Validate state between sessions (active, idle, disconnect)', async function ({ app, sessions }) {

		const { sessions: session, console } = app.workbench;

		// Start Python session
		const [pythonSession1] = await sessions.start(['python'], { waitForReady: false });

		// Verify Python session is visible and transitions from starting --> idle
		// Note displays as 'starting' in metadata dialog and as 'active' in session tab list
		await session.expectStatusToBe(pythonSession1.id, 'starting');
		await session.expectStatusToBe(pythonSession1.id, 'idle');

		// Restart Python session and confirm state returns to starting --> idle
		// Note displays as 'starting' in metadata dialog and as 'active' in session tab list
		await session.restartButton.click();
		await session.expectStatusToBe(pythonSession1.id, 'starting');
		await session.expectStatusToBe(pythonSession1.id, 'idle');

		// Start R session
		const [rSession1] = await sessions.start(['r'], { waitForReady: false });

		// Verify R session transitions from active --> idle while Python session remains idle
		await session.expectStatusToBe(rSession1.id, 'active');
		await session.expectStatusToBe(rSession1.id, 'idle');
		await session.expectStatusToBe(pythonSession1.id, 'idle');

		// Restart Python session, verify Python transitions to active --> idle and R remains idle
		await session.restart(pythonSession1.id, false);
		await session.expectStatusToBe(pythonSession1.id, 'active');
		await session.expectStatusToBe(pythonSession1.id, 'idle', { timeout: 60000 });
		await session.expectStatusToBe(rSession1.id, 'idle');

		// Shutdown Python session, verify Python transitions to disconnected while R remains idle
		await session.select(pythonSession1.id);
		await console.typeToConsole('exit()', true);
		await session.expectStatusToBe(pythonSession1.id, 'disconnected');
		await session.expectStatusToBe(rSession1.id, 'idle');

		// Restart R session, verify R to returns to active --> idle and Python remains disconnected
		await session.restart(rSession1.id, false);
		await session.expectStatusToBe(rSession1.id, 'active');
		await session.expectStatusToBe(rSession1.id, 'idle', { timeout: 60000 });
		await session.expectStatusToBe(pythonSession1.id, 'disconnected');

		// Shutdown R, verify both Python and R in disconnected state
		await session.select(rSession1.id);
		await console.typeToConsole('q()', true);
		await session.expectStatusToBe(rSession1.id, 'disconnected');
		await session.expectStatusToBe(pythonSession1.id, 'disconnected');
	});

	test('Validate state displays as active when executing code', async function ({ app, sessions }) {
		const { sessions: session, console } = app.workbench;

		// Start Python and R sessions
		const [pythonSession1, rSession1] = await sessions.start(['python', 'r']);

		// Verify Python session transitions to active when executing code
		await session.select(pythonSession1.name);
		await console.typeToConsole('import time', true);
		await console.typeToConsole('time.sleep(5)', true);
		await session.expectStatusToBe(pythonSession1.name, 'active');

		// Verify R session transitions to active when executing code
		// Verify Python session continues to run and transitions to idle when finished
		await session.select(rSession1.name);
		await console.typeToConsole('Sys.sleep(1)', true);
		await session.expectStatusToBe(rSession1.name, 'active');
		await session.expectStatusToBe(rSession1.name, 'idle');
		await session.expectStatusToBe(pythonSession1.name, 'active');
		await session.expectStatusToBe(pythonSession1.name, 'idle');
	});

	test('Validate metadata between sessions', async function ({ app, sessions }) {
		const { sessions: session, console } = app.workbench;

		// Ensure sessions exist and are idle
		const [pythonSession1, pythonSession2, rSession1] = await sessions.start(['python', 'python', 'r']);

		// Verify Python session metadata
		await session.expectMetaDataToBe({ ...pythonSession1, state: 'idle' });
		await session.expectMetaDataToBe({ ...pythonSession2, state: 'idle' });
		await session.expectMetaDataToBe({ ...rSession1, state: 'idle' });

		// Shutdown Python session 1 and verify metadata
		await session.select(pythonSession1.id);
		await console.typeToConsole('exit()', true);
		await session.expectMetaDataToBe({ ...pythonSession1, state: 'exited' });
		await session.expectMetaDataToBe({ ...pythonSession2, state: 'idle' });

		// Shutdown R session and verify metadata
		await session.select(rSession1.id);
		await console.typeToConsole('q()', true);
		await session.expectMetaDataToBe({ ...rSession1, state: 'exited' });
		await session.expectMetaDataToBe({ ...pythonSession2, state: 'idle' });

		// Shutdown Python session 2 and verify metadata
		await console.typeToConsole('exit()', true);
		await session.expectMetaDataToBe({ ...pythonSession2, state: 'exited' });
	});
});
