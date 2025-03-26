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

	test.beforeEach(async function ({ app, sessions }) {
		await app.workbench.variables.togglePane('hide');
		await sessions.deleteDisconnectedSessions();
	});

	test.afterEach(async function ({ sessions }) {
		await sessions.clearConsoleAllSessions();
	});

	test.skip('Validate state between sessions (active, idle, disconnect)', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/6987' }]
	}, async function ({ app, sessions }) {

		const { console } = app.workbench;

		// Start Python session
		const pySession = await sessions.start('python', { waitForReady: false });

		// Verify Python session is visible and transitions from starting --> idle
		// Note displays as 'starting' in metadata dialog and as 'active' in session tab list
		await sessions.expectStatusToBe(pySession.id, 'starting');
		await sessions.expectStatusToBe(pySession.id, 'idle');

		// Restart Python session and confirm state returns to starting --> idle
		// Note displays as 'starting' in metadata dialog and as 'active' in session tab list
		await sessions.restartButton.click();
		await sessions.expectStatusToBe(pySession.id, 'starting');
		await sessions.expectStatusToBe(pySession.id, 'idle');

		// Start R session
		const rSession = await sessions.start('r', { waitForReady: false });

		// Verify R session transitions from active --> idle while Python session remains idle
		await sessions.expectStatusToBe(rSession.id, 'active');
		await sessions.expectStatusToBe(rSession.id, 'idle');
		await sessions.expectStatusToBe(pySession.id, 'idle');

		// Restart Python session, verify Python transitions to active --> idle and R remains idle
		await sessions.restart(pySession.id, { waitForIdle: false });
		await sessions.expectStatusToBe(pySession.id, 'active');
		await sessions.expectStatusToBe(pySession.id, 'idle', { timeout: 60000 });
		await sessions.expectStatusToBe(rSession.id, 'idle');

		// Shutdown Python session, verify Python transitions to disconnected while R remains idle
		await sessions.select(pySession.id);
		await console.typeToConsole('exit()', true);
		await sessions.expectStatusToBe(pySession.id, 'disconnected');
		await sessions.expectStatusToBe(rSession.id, 'idle');

		// Restart R session, verify R to returns to active --> idle and Python remains disconnected
		await sessions.restart(rSession.id, { waitForIdle: false });
		await sessions.expectStatusToBe(rSession.id, 'active');
		await sessions.expectStatusToBe(rSession.id, 'idle', { timeout: 60000 });
		await sessions.expectStatusToBe(pySession.id, 'disconnected');

		// Shutdown R, verify both Python and R in disconnected state
		await sessions.select(rSession.id);
		await console.typeToConsole('q()', true);
		await sessions.expectStatusToBe(rSession.id, 'disconnected');
		await sessions.expectStatusToBe(pySession.id, 'disconnected');
	});

	test('Validate state displays as active when executing code', async function ({ app, sessions }) {
		const { console } = app.workbench;

		// Start Python and R sessions
		const [pySession, rSession] = await sessions.start(['python', 'r',]);

		// Verify Python session transitions to active when executing code
		await sessions.select(pySession.name);
		await console.typeToConsole('import time', true);
		await console.typeToConsole('time.sleep(7)', true);
		await sessions.expectStatusToBe(pySession.name, 'active');

		// Verify R session transitions to active when executing code
		// Verify Python session continues to run and transitions to idle when finished
		await sessions.select(rSession.name);
		await console.typeToConsole('Sys.sleep(2)', true);
		await sessions.expectStatusToBe(rSession.name, 'active');
		await sessions.expectStatusToBe(rSession.name, 'idle');
		await sessions.expectStatusToBe(pySession.name, 'active');
		await sessions.expectStatusToBe(pySession.name, 'idle');
	});

	// BUG: why is a new session starting at the end of this test?
	test('Validate metadata between sessions', async function ({ app, sessions }) {
		const { console } = app.workbench;

		// Ensure sessions exist and are idle
		const [pySession, rSession, pySessionAlt] = await sessions.start(['python', 'r', 'pythonAlt']);

		// Verify Python session metadata
		await sessions.expectMetaDataToBe({ ...pySession, state: 'idle' });
		await sessions.expectMetaDataToBe({ ...rSession, state: 'idle' });
		await sessions.expectMetaDataToBe({ ...pySessionAlt, state: 'idle' });

		// Shutdown Python session and verify metadata
		await sessions.select(pySession.id);
		await console.typeToConsole('exit()', true);
		await sessions.expectMetaDataToBe({ ...pySession, state: 'exited' });
		await sessions.expectMetaDataToBe({ ...rSession, state: 'idle' });
		await sessions.expectMetaDataToBe({ ...pySessionAlt, state: 'idle' });

		// Shutdown R session and verify metadata
		await sessions.select(rSession.id);
		await console.typeToConsole('q()', true);
		await sessions.expectMetaDataToBe({ ...pySession, state: 'exited' });
		await sessions.expectMetaDataToBe({ ...rSession, state: 'exited' });
		await sessions.expectMetaDataToBe({ ...pySessionAlt, state: 'idle' });

		// Shutdown Alt Python session and verify metadata
		await sessions.select(pySessionAlt.id);
		await console.typeToConsole('exit()', true);
		await sessions.expectMetaDataToBe({ ...pySession, state: 'exited' });
		await sessions.expectMetaDataToBe({ ...rSession, state: 'exited' });
		await sessions.expectMetaDataToBe({ ...pySessionAlt, state: 'exited' });
	});
});
