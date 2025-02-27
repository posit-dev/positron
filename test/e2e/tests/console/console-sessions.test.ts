/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';
import { SessionName } from '../../infra';

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

	/**
	 * NOTE: updated by @dhruvisompura
	 *
	 * These tests need to be updated to shutdown a session via a different method
	 * The shutdown console button is no longer displayed to users in the multiple
	 * console sesison world
	 */
	test('Validate state between sessions (active, idle, disconnect) ', async function ({ app }) {
		const sessions = app.workbench.sessions;

		// Start Python session
		await app.workbench.sessions.launch({ ...pythonSession, waitForReady: false });

		// Verify Python session is visible and transitions from active --> idle
		await sessions.checkStatus(pythonSession, 'active');
		await sessions.checkStatus(pythonSession, 'idle');

		// Restart Python session and confirm state returns to active --> idle
		await sessions.restart(pythonSession, false);
		await sessions.checkStatus(pythonSession, 'active');
		await sessions.checkStatus(pythonSession, 'idle');

		// Start R session
		await app.workbench.sessions.launch({ ...rSession, waitForReady: false });

		// Verify R session transitions from active --> idle while Python session remains idle
		await sessions.checkStatus(rSession, 'active');
		await sessions.checkStatus(rSession, 'idle');
		await sessions.checkStatus(pythonSession, 'idle');

		// Shutdown Python session, verify Python transitions to disconnected while R remains idle
		//await sessions.shutdown(pythonSession, false);
		//await sessions.checkStatus(pythonSession, 'disconnected');
		//await sessions.checkStatus(rSession, 'idle');

		// Restart R session, verify R to returns to active --> idle and Python remains idle
		await sessions.restart(rSession, false);
		await sessions.checkStatus(rSession, 'active');
		await sessions.checkStatus(rSession, 'idle');
		await sessions.checkStatus(pythonSession, 'idle');

		// Shutdown R, verify both Python and R in disconnected state
		//await sessions.shutdown(rSession, false);
		//await sessions.checkStatus(rSession, 'disconnected');
		//await sessions.checkStatus(pythonSession, 'disconnected');
	});

	test('Validate session state displays as active when executing code', async function ({ app }) {
		const sessions = app.workbench.sessions;
		const console = app.workbench.console;

		// Ensure sessions exist and are idle
		await sessions.ensureStartedAndIdle(pythonSession);
		await sessions.ensureStartedAndIdle(rSession);

		// Verify Python session transitions to active when executing code
		await sessions.select(pythonSession);
		await console.typeToConsole('import time', true);
		await console.typeToConsole('time.sleep(1)', true);
		await sessions.checkStatus(pythonSession, 'active');
		await sessions.checkStatus(pythonSession, 'idle');

		// Verify R session transitions to active when executing code
		await sessions.select(rSession);
		await console.typeToConsole('Sys.sleep(1)', true);
		await sessions.checkStatus(rSession, 'active');
		await sessions.checkStatus(rSession, 'idle');
	});

	/**
	 * NOTE: commented out by @dhruvisompura
	 *
	 * These tests need to be updated to shutdown a session via a different method
	 * The shutdown console button is no longer displayed to users in the multiple
	 * console sesison world
	 */
	// test('Validate metadata between sessions', {
	// 	annotation: [
	// 		{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/6389' }]
	// }, async function ({ app }) {
	// 	const sessions = app.workbench.sessions;

	// 	// Ensure sessions exist and are idle
	// 	await sessions.ensureStartedAndIdle(pythonSession);
	// 	await sessions.ensureStartedAndIdle(rSession);

	// 	// Verify Python session metadata
	// 	await sessions.checkMetadata({ ...pythonSession, state: 'idle' });
	// 	await sessions.checkMetadata({ ...rSession, state: 'idle' });

	// 	// Shutdown Python session and verify metadata
	// 	await sessions.shutdown(pythonSession);
	// 	await sessions.checkMetadata({ ...pythonSession, state: 'exited' });

	// 	// Shutdown R session and verify metadata
	// 	await sessions.shutdown(rSession);
	// 	await sessions.checkMetadata({ ...rSession, state: 'exited' });
	// });

	test('Validate variables between sessions', {
		tag: [tags.VARIABLES]
	}, async function ({ app }) {
		const sessions = app.workbench.sessions;
		const console = app.workbench.console;
		const variables = app.workbench.variables;

		// Ensure sessions exist and are idle
		await sessions.ensureStartedAndIdle(pythonSession);
		await sessions.ensureStartedAndIdle(rSession);

		// Set and verify variables in Python
		await sessions.select(pythonSession);
		await console.typeToConsole('x = 1', true);
		await console.typeToConsole('y = 2', true);
		await variables.checkRuntime(pythonSession);
		await variables.checkVariableValue('x', '1');
		await variables.checkVariableValue('y', '2');

		// Set and verify variables in R
		await sessions.select(rSession);
		await console.typeToConsole('x <- 3', true);
		await console.typeToConsole('z <- 4', true);
		await variables.checkRuntime(rSession);
		await variables.checkVariableValue('x', '3');
		await variables.checkVariableValue('z', '4');

		// Switch back to Python, update variables, and verify
		await sessions.select(pythonSession);
		await console.typeToConsole('x = 0', true);
		await variables.checkRuntime(pythonSession);
		await variables.checkVariableValue('x', '0');
		await variables.checkVariableValue('y', '2');

		// Switch back to R, verify variables remain unchanged
		await sessions.select(rSession);
		await variables.checkRuntime(rSession);
		await variables.checkVariableValue('x', '3');
		await variables.checkVariableValue('z', '4');
	});

	/**
	 * NOTE: updated by @dhruvisompura
	 *
	 * These tests need to be updated to shutdown a session via a different method
	 * The shutdown console button is no longer displayed to users in the multiple
	 * console sesison world
	 */
	test('Validate active session list in console matches active session list in session picker', {
		annotation: [
			{ type: 'issue', description: 'sessions are not correctly sorted atm. see line 174.' }
		]
	}, async function ({ app }) {
		const sessions = app.workbench.sessions;
		const interpreter = app.workbench.sessions.quickPick;

		// Ensure sessions exist and are idle
		await sessions.ensureStartedAndIdle(pythonSession);
		await sessions.ensureStartedAndIdle(rSession);

		// Get active sessions and verify they match the session picker: order matters!
		let activeSessionsFromConsole = await sessions.getActiveSessions();
		let activeSessionsFromPicker = await interpreter.getActiveSessions();
		expect(activeSessionsFromConsole).toStrictEqual(activeSessionsFromPicker);

		// Shutdown Python session and verify active sessions
		// await sessions.shutdown(pythonSession);
		// activeSessionsFromConsole = await sessions.getActiveSessions();
		// activeSessionsFromPicker = await interpreter.getActiveSessions();
		// expect(activeSessionsFromConsole).toStrictEqual(activeSessionsFromPicker);

		// Shutdown R session and verify active sessions
		// await sessions.shutdown(rSession);
		// activeSessionsFromConsole = await sessions.getActiveSessions();
		// activeSessionsFromPicker = await interpreter.getActiveSessions();
		// expect(activeSessionsFromConsole).toStrictEqual(activeSessionsFromPicker);

		// Start Python session (again) and verify active sessions
		// await sessions.start(pythonSession);
		// activeSessionsFromConsole = await sessions.getActiveSessions();
		// activeSessionsFromPicker = await interpreter.getActiveSessions();
		// expect(activeSessionsFromConsole).toStrictEqual(activeSessionsFromPicker);

		// Restart Python session and verify active sessions
		await sessions.restart(pythonSession);
		activeSessionsFromConsole = await sessions.getActiveSessions();
		activeSessionsFromPicker = await interpreter.getActiveSessions();
		expect(activeSessionsFromConsole).toStrictEqual(activeSessionsFromPicker);
	});
});
