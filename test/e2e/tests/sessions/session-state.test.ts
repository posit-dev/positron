/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Sessions: State', {
	tag: [tags.WIN, tags.WEB, tags.CONSOLE, tags.SESSIONS, tags.CRITICAL]
}, () => {

	test.beforeEach(async function ({ hotKeys, sessions }) {
		await hotKeys.closeSecondarySidebar();
		await sessions.deleteDisconnectedSessions();
		await sessions.clearConsoleAllSessions();
	});

	test('Validate session states during start, restart, and shutdown', { tag: [tags.ARK] }, async function ({ app, sessions }) {
		const { console } = app.workbench;
		// using this session to trigger session tab list view below to verify session states
		await sessions.start(['r']);

		// Start Python session
		// Launching directly to avoid missing state transitions caused by metadata dialog interaction
		const pySessionId = await sessions.startAndSkipMetadata({ language: 'Python', waitForReady: false });

		// Verify Python session is visible and transitions from starting --> idle
		// Note displays as 'starting' in metadata dialog and as 'active' in session tab list
		await sessions.expectStatusToBe(pySessionId, 'active');
		await sessions.expectStatusToBe(pySessionId, 'idle');

		// Restart Python session and confirm state returns to starting --> idle
		// Note displays as 'starting' in metadata dialog and as 'active' in session tab list
		await sessions.restart(pySessionId, { waitForIdle: false });
		await sessions.expectStatusToBe(pySessionId, 'active');
		await sessions.expectStatusToBe(pySessionId, 'idle', { timeout: 60000 });

		// Start R session
		// Launching directly to avoid missing state transitions caused by metadata dialog interaction
		const rSessionId = await sessions.startAndSkipMetadata({ language: 'R', waitForReady: false });

		// Verify R session transitions from active --> idle while Python session remains idle
		await sessions.expectStatusToBe(rSessionId, 'active');
		await sessions.expectStatusToBe(rSessionId, 'idle');
		await sessions.expectStatusToBe(pySessionId, 'idle');

		// Restart Python session, verify Python transitions to active --> idle and R remains idle
		await sessions.restart(pySessionId, { waitForIdle: false });
		await sessions.expectStatusToBe(pySessionId, 'active');
		await sessions.expectStatusToBe(pySessionId, 'idle', { timeout: 60000 });
		await sessions.expectStatusToBe(rSessionId, 'idle');

		// Shutdown Python session, verify Python transitions to disconnected while R remains idle
		await sessions.select(pySessionId);
		await console.executeCode('Python', 'exit()', { waitForReady: false });
		await sessions.expectStatusToBe(pySessionId, 'disconnected');
		await sessions.expectStatusToBe(rSessionId, 'idle');

		// Restart R session, verify R to returns to active --> idle and Python remains disconnected
		await sessions.restart(rSessionId, { waitForIdle: false });
		await sessions.expectStatusToBe(rSessionId, 'active');
		await sessions.expectStatusToBe(rSessionId, 'idle', { timeout: 60000 });
		await sessions.expectStatusToBe(pySessionId, 'disconnected');

		// Shutdown R, verify both Python and R in disconnected state
		await sessions.select(rSessionId);
		await console.executeCode('R', 'q()', { waitForReady: false });
		await sessions.expectStatusToBe(rSessionId, 'disconnected');
		await sessions.expectStatusToBe(pySessionId, 'disconnected');
	});

	test('Validate state displays as active when executing code', async function ({ app, sessions }) {
		const { console } = app.workbench;

		// Start Python and R sessions
		const [pySession, rSession] = await sessions.start(['python', 'r',]);

		// Verify Python session transitions to active when executing code
		await sessions.select(pySession.name);
		await console.executeCode('Python', 'import time');
		await console.pasteCodeToConsole('time.sleep(10)', true);
		await sessions.expectStatusToBe(pySession.name, 'active');

		// Verify R session transitions to active when executing code
		// Verify Python session continues to run and transitions to idle when finished
		await sessions.select(rSession.name);
		await console.pasteCodeToConsole('Sys.sleep(2)', true);
		await sessions.expectStatusToBe(rSession.name, 'active');
		await sessions.expectStatusToBe(rSession.name, 'idle');
		await sessions.expectStatusToBe(pySession.name, 'active');
		await sessions.expectStatusToBe(pySession.name, 'idle');
	});

	test('Validate metadata between sessions', async function ({ app, sessions }) {
		const { console } = app.workbench;

		// Ensure sessions exist and are idle
		const [pySession, rSession, pySessionAlt] = await sessions.start(['python', 'r', 'pythonAlt']);
		await sessions.resizeSessionList({ x: -100 });

		// Verify Python session metadata
		await sessions.expectMetadataToBe({ ...pySession, state: 'idle' });
		await sessions.expectMetadataToBe({ ...rSession, state: 'idle' });
		await sessions.expectMetadataToBe({ ...pySessionAlt, state: 'idle' });

		// Shutdown Python session and verify metadata
		await sessions.select(pySession.id);
		await console.executeCode('Python', 'exit()', { waitForReady: false });
		await sessions.expectMetadataToBe({ ...pySession, state: 'exited' });
		await sessions.expectMetadataToBe({ ...rSession, state: 'idle' });
		await sessions.expectMetadataToBe({ ...pySessionAlt, state: 'idle' });

		// Shutdown R session and verify metadata
		await sessions.select(rSession.id);
		await console.executeCode('R', 'q()', { waitForReady: false });
		await sessions.expectMetadataToBe({ ...pySession, state: 'exited' });
		await sessions.expectMetadataToBe({ ...rSession, state: 'exited' });
		await sessions.expectMetadataToBe({ ...pySessionAlt, state: 'idle' });

		// Shutdown Alt Python session and verify metadata
		await sessions.select(pySessionAlt.id);
		await console.executeCode('Python', 'exit()', { waitForReady: false });
		await sessions.expectMetadataToBe({ ...pySession, state: 'exited' });
		await sessions.expectMetadataToBe({ ...rSession, state: 'exited' });
		await sessions.expectMetadataToBe({ ...pySessionAlt, state: 'exited' });
	});
});
