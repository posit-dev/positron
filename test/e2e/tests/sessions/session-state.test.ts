/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { pythonSession, pythonSessionAlt, rSession } from '../../infra';

const pythonSession1 = { ...pythonSession };
const pythonSession2 = { ...pythonSessionAlt };
const rSession1 = { ...rSession };

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

	test('Validate state between sessions (active, idle, disconnect)', async function ({ app }) {
		const sessions = app.workbench.sessions;
		const console = app.workbench.console;

		// Start Python session
		pythonSession1.id = await sessions.launch({ ...pythonSession1, waitForReady: false });

		// Verify Python session is visible and transitions from starting --> idle
		// Note displays as 'starting' in metadata dialog and as 'active' in session tab list
		await sessions.expectStatusToBe(pythonSession1.id, 'starting');
		await sessions.expectStatusToBe(pythonSession1.id, 'idle');

		// Restart Python session and confirm state returns to starting --> idle
		// Note displays as 'starting' in metadata dialog and as 'active' in session tab list
		await sessions.restartButton.click();
		await sessions.expectStatusToBe(pythonSession1.id, 'starting');
		await sessions.expectStatusToBe(pythonSession1.id, 'idle');

		// Start R session
		rSession1.id = await sessions.launch({ ...rSession1, waitForReady: false });

		// Verify R session transitions from active --> idle while Python session remains idle
		await sessions.expectStatusToBe(rSession1.id, 'active');
		await sessions.expectStatusToBe(rSession1.id, 'idle');
		await sessions.expectStatusToBe(pythonSession1.id, 'idle');

		// Restart Python session, verify Python transitions to active --> idle and R remains idle
		await sessions.restart(pythonSession1.id, false);
		await sessions.expectStatusToBe(pythonSession1.id, 'active');
		await sessions.expectStatusToBe(pythonSession1.id, 'idle', { timeout: 60000 });
		await sessions.expectStatusToBe(rSession1.id, 'idle');

		// Shutdown Python session, verify Python transitions to disconnected while R remains idle
		await sessions.select(pythonSession1.id);
		await console.typeToConsole('exit()', true);
		await sessions.expectStatusToBe(pythonSession1.id, 'disconnected');
		await sessions.expectStatusToBe(rSession1.id, 'idle');

		// Restart R session, verify R to returns to active --> idle and Python remains disconnected
		await sessions.restart(rSession1.id, false);
		await sessions.expectStatusToBe(rSession1.id, 'active');
		await sessions.expectStatusToBe(rSession1.id, 'idle', { timeout: 60000 });
		await sessions.expectStatusToBe(pythonSession1.id, 'disconnected');

		// Shutdown R, verify both Python and R in disconnected state
		await sessions.select(rSession1.id);
		await console.typeToConsole('q()', true);
		await sessions.expectStatusToBe(rSession1.id, 'disconnected');
		await sessions.expectStatusToBe(pythonSession1.id, 'disconnected');
	});

	test('Validate state displays as active when executing code', async function ({ app }) {
		const sessions = app.workbench.sessions;
		const console = app.workbench.console;

		// Start Python and R sessions
		pythonSession1.id = await sessions.reuseIdleSessionIfExists(pythonSession1);
		rSession1.id = await sessions.reuseIdleSessionIfExists(rSession1);

		// Verify Python session transitions to active when executing code
		await sessions.select(pythonSession1.name);
		await console.typeToConsole('import time', true);
		await console.typeToConsole('time.sleep(3)', true);
		await sessions.expectStatusToBe(pythonSession1.name, 'active');

		// Verify R session transitions to active when executing code
		// Verify Python session continues to run and transitions to idle when finished
		await sessions.select(rSession1.name);
		await console.typeToConsole('Sys.sleep(1)', true);
		await sessions.expectStatusToBe(rSession1.name, 'active');
		await sessions.expectStatusToBe(rSession1.name, 'idle');
		await sessions.expectStatusToBe(pythonSession1.name, 'active');
		await sessions.expectStatusToBe(pythonSession1.name, 'idle');
	});

	test('Validate metadata between sessions', async function ({ app }) {
		const sessions = app.workbench.sessions;
		const console = app.workbench.console;

		// Ensure sessions exist and are idle
		pythonSession1.id = await sessions.reuseIdleSessionIfExists(pythonSession1);
		pythonSession2.id = await sessions.reuseIdleSessionIfExists(pythonSession2);
		rSession1.id = await sessions.reuseIdleSessionIfExists(rSession1);

		// Verify Python session metadata
		await sessions.expectMetaDataToBe({ ...pythonSession1, state: 'idle' });
		await sessions.expectMetaDataToBe({ ...pythonSession2, state: 'idle' });
		await sessions.expectMetaDataToBe({ ...rSession1, state: 'idle' });

		// Shutdown Python session 1 and verify metadata
		await sessions.select(pythonSession1.id);
		await console.typeToConsole('exit()', true);
		await sessions.expectMetaDataToBe({ ...pythonSession1, state: 'exited' });
		await sessions.expectMetaDataToBe({ ...pythonSession2, state: 'idle' });

		// Shutdown R session and verify metadata
		await sessions.select(rSession1.id);
		await console.typeToConsole('q()', true);
		await sessions.expectMetaDataToBe({ ...rSession1, state: 'exited' });
		await sessions.expectMetaDataToBe({ ...pythonSession2, state: 'idle' });

		// Shutdown Python session 2 and verify metadata
		await console.typeToConsole('exit()', true);
		await sessions.expectMetaDataToBe({ ...pythonSession2, state: 'exited' });
	});
});
