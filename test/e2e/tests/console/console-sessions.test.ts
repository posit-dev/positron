/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';
import { SessionName } from '../../pages/session';

const pythonSession: SessionName = {
	language: 'Python',
	version: process.env.POSITRON_PY_VER_SEL || ''
};
const rSession: SessionName = {
	language: 'R',
	version: process.env.POSITRON_R_VER_SEL || ''
};

test.use({
	suiteId: __filename
});

test.describe('Console: Sessions', {
	tag: [tags.WIN, tags.WEB, tags.CONSOLE, tags.SESSIONS]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test.beforeEach(async function ({ app }) {
		await app.workbench.variables.togglePane('hide');
	});

	test('Validate state between sessions (active, idle, disconnect) ', async function ({ app }) {
		const session = app.workbench.session;

		// Start Python session
		await app.workbench.console.startSession({ ...pythonSession, waitForReady: false });

		// Verify Python session is visible and transitions from active --> idle
		await session.checkStatus(pythonSession, 'active');
		await session.checkStatus(pythonSession, 'idle');

		// Restart Python session and confirm state returns to active --> idle
		await session.restart(pythonSession, false);
		await session.checkStatus(pythonSession, 'active');
		await session.checkStatus(pythonSession, 'idle');

		// Start R session
		await app.workbench.console.startSession({ ...rSession, waitForReady: false });

		// Verify R session transitions from active --> idle while Python session remains idle
		await session.checkStatus(rSession, 'active');
		await session.checkStatus(rSession, 'idle');
		await session.checkStatus(pythonSession, 'idle');

		// Shutdown Python session, verify Python transitions to disconnected while R remains idle
		await session.shutdown(pythonSession, false);
		await session.checkStatus(pythonSession, 'disconnected');
		await session.checkStatus(rSession, 'idle');

		// Restart R session, verify R to returns to active --> idle and Python remains disconnected
		await session.restart(rSession, false);
		await session.checkStatus(rSession, 'active');
		await session.checkStatus(rSession, 'idle');
		await session.checkStatus(pythonSession, 'disconnected');

		// Shutdown R, verify both Python and R in disconnected state
		await session.shutdown(rSession, false);
		await session.checkStatus(rSession, 'disconnected');
		await session.checkStatus(pythonSession, 'disconnected');
	});

	test('Validate session state displays as active when executing code', async function ({ app }) {
		const session = app.workbench.session;
		const console = app.workbench.console;

		// Ensure sessions exist and are idle
		await session.ensureStartedAndIdle(pythonSession);
		await session.ensureStartedAndIdle(rSession);

		// Verify Python session transitions to active when executing code
		await session.select(pythonSession);
		await console.typeToConsole('import time', true);
		await console.typeToConsole('time.sleep(1)', true);
		await session.checkStatus(pythonSession, 'active');
		await session.checkStatus(pythonSession, 'idle');

		// Verify R session transitions to active when executing code
		await session.select(rSession);
		await console.typeToConsole('Sys.sleep(1)', true);
		await session.checkStatus(rSession, 'active');
		await session.checkStatus(rSession, 'idle');
	});

	test('Validate metadata between sessions', {
		annotation: [
			{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/6389' }]
	}, async function ({ app }) {
		const session = app.workbench.session;

		// Ensure sessions exist and are idle
		await session.ensureStartedAndIdle(pythonSession);
		await session.ensureStartedAndIdle(rSession);

		// Verify Python session metadata
		await session.checkMetadata({ ...pythonSession, state: 'idle' });
		await session.checkMetadata({ ...rSession, state: 'idle' });

		// Shutdown Python session and verify metadata
		await session.shutdown(pythonSession);
		await session.checkMetadata({ ...pythonSession, state: 'exited' });

		// Shutdown R session and verify metadata
		await session.shutdown(rSession);
		await session.checkMetadata({ ...rSession, state: 'exited' });
	});

	test('Validate variables between sessions', {
		tag: [tags.VARIABLES]
	}, async function ({ app }) {
		const session = app.workbench.session;
		const console = app.workbench.console;
		const variables = app.workbench.variables;

		// Ensure sessions exist and are idle
		await session.ensureStartedAndIdle(pythonSession);
		await session.ensureStartedAndIdle(rSession);

		// Set and verify variables in Python
		await session.select(pythonSession);
		await console.typeToConsole('x = 1', true);
		await console.typeToConsole('y = 2', true);
		await variables.checkRuntime(pythonSession);
		await variables.checkVariableValue('x', '1');
		await variables.checkVariableValue('y', '2');

		// Set and verify variables in R
		await session.select(rSession);
		await console.typeToConsole('x <- 3', true);
		await console.typeToConsole('z <- 4', true);
		await variables.checkRuntime(rSession);
		await variables.checkVariableValue('x', '3');
		await variables.checkVariableValue('z', '4');

		// Switch back to Python, update variables, and verify
		await session.select(pythonSession);
		await console.typeToConsole('x = 0', true);
		await variables.checkRuntime(pythonSession);
		await variables.checkVariableValue('x', '0');
		await variables.checkVariableValue('y', '2');

		// Switch back to R, verify variables remain unchanged
		await session.select(rSession);
		await variables.checkRuntime(rSession);
		await variables.checkVariableValue('x', '3');
		await variables.checkVariableValue('z', '4');
	});

	test('Validate active session list in console matches active session list in session picker', {
		annotation: [
			{ type: 'issue', description: 'sessions are not correctly sorted atm. see line 174.' }
		]
	}, async function ({ app }) {
		const session = app.workbench.session;
		const interpreter = app.workbench.interpreterNew;

		// Ensure sessions exist and are idle
		await session.ensureStartedAndIdle(pythonSession);
		await session.ensureStartedAndIdle(rSession);

		// Get active sessions and verify they match the session picker: order matters!
		let activeSessionsFromConsole = await session.getActiveSessions();
		let activeSessionsFromPicker = await interpreter.getActiveSessions();
		expect(activeSessionsFromConsole).toStrictEqual(activeSessionsFromPicker);

		// Shutdown Python session and verify active sessions
		await session.shutdown(pythonSession);
		activeSessionsFromConsole = await session.getActiveSessions();
		activeSessionsFromPicker = await interpreter.getActiveSessions();
		expect(activeSessionsFromConsole).toStrictEqual(activeSessionsFromPicker);

		// Shutdown R session and verify active sessions
		await session.shutdown(rSession);
		activeSessionsFromConsole = await session.getActiveSessions();
		activeSessionsFromPicker = await interpreter.getActiveSessions();
		expect(activeSessionsFromConsole).toStrictEqual(activeSessionsFromPicker);

		// Start Python session (again) and verify active sessions
		await session.start(pythonSession);
		activeSessionsFromConsole = await session.getActiveSessions();
		activeSessionsFromPicker = await interpreter.getActiveSessions();
		expect(activeSessionsFromConsole).toStrictEqual(activeSessionsFromPicker);

		// Restart Python session and verify active sessions
		await session.restart(pythonSession);
		activeSessionsFromConsole = await session.getActiveSessions();
		activeSessionsFromPicker = await interpreter.getActiveSessions();
		expect(activeSessionsFromConsole).toStrictEqual(activeSessionsFromPicker);
	});
});
