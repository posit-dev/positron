/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';
import { SessionInfo } from '../../infra';

const pythonSession: SessionInfo = {
	name: `Python ${process.env.POSITRON_PY_VER_SEL || ''}`,
	language: 'Python',
	version: process.env.POSITRON_PY_VER_SEL || ''
};
const rSession: SessionInfo = {
	name: `R ${process.env.POSITRON_R_VER_SEL || ''}`,
	language: 'R',
	version: process.env.POSITRON_R_VER_SEL || ''
};

test.use({
	suiteId: __filename
});

test.describe('Sessions', {
	tag: [tags.WIN, tags.WEB, tags.CONSOLE, tags.SESSIONS]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test.beforeEach(async function ({ app }) {
		await app.workbench.variables.togglePane('hide');
	});

	test('Validate state between sessions (active, idle, disconnect) ', async function ({ app }) {
		const sessions = app.workbench.sessions;
		const console = app.workbench.console;

		// Start Python session
		pythonSession.id = await app.workbench.sessions.launch({ ...pythonSession, waitForReady: false });

		// Verify Python session is visible and transitions from active --> idle
		await sessions.expectStatusToBe(pythonSession.id, 'active');
		await sessions.expectStatusToBe(pythonSession.id, 'idle');

		// Restart Python session and confirm state returns to active --> idle
		await sessions.restart(pythonSession.id, false);
		await sessions.expectStatusToBe(pythonSession.id, 'active');
		await sessions.expectStatusToBe(pythonSession.id, 'idle');

		// Start R session
		rSession.id = await app.workbench.sessions.launch({ ...rSession, waitForReady: false });

		// Verify R session transitions from active --> idle while Python session remains idle
		await sessions.expectStatusToBe(rSession.id, 'active');
		await sessions.expectStatusToBe(rSession.id, 'idle');
		await sessions.expectStatusToBe(pythonSession.id, 'idle');

		// Shutdown Python session, verify Python transitions to disconnected while R remains idle
		await sessions.select(pythonSession.id);
		await console.typeToConsole('exit()', true);
		await sessions.expectStatusToBe(pythonSession.id, 'disconnected');
		await sessions.expectStatusToBe(rSession.id, 'idle');

		// Restart R session, verify R to returns to active --> idle and Python remains disconnected
		await sessions.restart(rSession.id, false);
		await sessions.expectStatusToBe(rSession.id, 'active');
		await sessions.expectStatusToBe(rSession.id, 'idle');
		// await sessions.checkStatus(pythonSession.id, 'disconnected');

		// Shutdown R, verify both Python and R in disconnected state
		await sessions.select(rSession.id);
		await console.typeToConsole('q()', true);
		await sessions.expectStatusToBe(rSession.id, 'disconnected');
		await sessions.expectStatusToBe(pythonSession.id, 'disconnected');
	});

	test('Validate session state displays as active when executing code', async function ({ app }) {
		const sessions = app.workbench.sessions;
		const console = app.workbench.console;

		// Start Python and R sessions
		pythonSession.id = await app.workbench.sessions.reuseSessionIfExists(pythonSession);
		rSession.id = await app.workbench.sessions.reuseSessionIfExists(rSession);

		// Verify Python session transitions to active when executing code
		await sessions.select(pythonSession.name);
		await console.typeToConsole('import time', true);
		await console.typeToConsole('time.sleep(3)', true);
		await sessions.expectStatusToBe(pythonSession.name, 'active');

		// Verify R session transitions to active when executing code
		// Verify Python session continues to run and transitions to idle when finished
		await sessions.select(rSession.name);
		await console.typeToConsole('Sys.sleep(1)', true);
		await sessions.expectStatusToBe(rSession.name, 'active');
		await sessions.expectStatusToBe(rSession.name, 'idle');
		await sessions.expectStatusToBe(pythonSession.name, 'active');
		await sessions.expectStatusToBe(pythonSession.name, 'idle');
	});

	test('Validate metadata between sessions', {
		annotation: [
			{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/6389' }]
	}, async function ({ app }) {
		const sessions = app.workbench.sessions;
		const console = app.workbench.console;

		// Ensure sessions exist and are idle
		pythonSession.id = await sessions.reuseSessionIfExists(pythonSession);
		rSession.id = await sessions.reuseSessionIfExists(rSession);

		// Verify Python session metadata
		await sessions.expectMetaDataToBe({ ...pythonSession, state: 'idle' });
		await sessions.expectMetaDataToBe({ ...rSession, state: 'idle' });

		// Shutdown Python session and verify metadata
		await sessions.select(pythonSession.name);
		await console.typeToConsole('exit()', true);
		await sessions.expectMetaDataToBe({ ...pythonSession, state: 'exited' });

		// Shutdown R session and verify metadata
		await sessions.select(rSession.name);
		await console.typeToConsole('q()', true);
		await sessions.expectMetaDataToBe({ ...rSession, state: 'exited' });
	});

	test('Validate variables between sessions', {
		tag: [tags.VARIABLES]
	}, async function ({ app }) {
		const sessions = app.workbench.sessions;
		const console = app.workbench.console;
		const variables = app.workbench.variables;

		// Ensure sessions exist and are idle
		pythonSession.id = await sessions.reuseSessionIfExists(pythonSession);
		rSession.id = await sessions.reuseSessionIfExists(rSession);

		// Set and verify variables in Python
		await sessions.select(pythonSession.name);
		await console.typeToConsole('x = 1', true);
		await console.typeToConsole('y = 2', true);
		await variables.expectRuntimeToBe(pythonSession.name);
		await variables.expectVariableToBe('x', '1');
		await variables.expectVariableToBe('y', '2');

		// Set and verify variables in R
		await sessions.select(rSession.name);
		await console.typeToConsole('x <- 3', true);
		await console.typeToConsole('z <- 4', true);
		await variables.expectRuntimeToBe(rSession.name);
		await variables.expectVariableToBe('x', '3');
		await variables.expectVariableToBe('z', '4');

		// Switch back to Python, update variables, and verify
		await sessions.select(pythonSession.name);
		await console.typeToConsole('x = 0', true);
		await variables.expectRuntimeToBe(pythonSession.name);
		await variables.expectVariableToBe('x', '0');
		await variables.expectVariableToBe('y', '2');

		// Switch back to R, verify variables remain unchanged
		await sessions.select(rSession.name);
		await variables.expectRuntimeToBe(rSession.name);
		await variables.expectVariableToBe('x', '3');
		await variables.expectVariableToBe('z', '4');
	});

	test('Validate active session list in console matches active session list in session picker', {
		annotation: [
			{ type: 'issue', description: 'sessions are not correctly sorted atm. see line 174.' }
		]
	}, async function ({ app }) {
		const sessions = app.workbench.sessions;
		const console = app.workbench.console;

		// Start sessions and verify active sessions: order matters!
		pythonSession.id = await sessions.reuseSessionIfExists(pythonSession);
		rSession.id = await sessions.reuseSessionIfExists(rSession);
		await sessions.expectSessionCountToBe(2, 'active');
		await sessions.expectSessionListsToMatch();

		// Shutdown Python session and verify active sessions
		await sessions.select(pythonSession.name);
		await console.typeToConsole('exit()', true);
		await sessions.expectSessionCountToBe(1, 'active');
		await sessions.expectSessionListsToMatch();

		// Shutdown R session and verify active sessions
		await sessions.select(rSession.name);
		await console.typeToConsole('q()', true);
		await sessions.expectSessionCountToBe(0, 'active');
		await sessions.expectSessionListsToMatch();

		// Start Python session (again) and verify active sessions
		await sessions.start(pythonSession.name);
		await sessions.expectSessionCountToBe(1, 'active');
		await sessions.expectSessionListsToMatch();

		// Restart Python session and verify active sessions
		await sessions.restart(pythonSession.name);
		await sessions.expectSessionCountToBe(1, 'active');
		await sessions.expectSessionListsToMatch();
	});

	test('Validate can delete sessions', async function ({ app }) {
		const sessions = app.workbench.sessions;
		const variables = app.workbench.variables;

		// Ensure sessions exist and are idle
		await sessions.reuseSessionIfExists(pythonSession);
		await sessions.reuseSessionIfExists(rSession);

		// Delete 1st session and verify active sessions and runtime in session picker
		await sessions.delete(pythonSession.name);
		await sessions.expectSessionCountToBe(1);
		await sessions.expectSessionListsToMatch();
		await variables.expectRuntimeToBe(rSession.name);

		// Delete 2nd session and verify no active sessions or runtime in session picker
		await sessions.delete(rSession.name);
		await expect(sessions.chooseSessionButton).toHaveText('Choose Session');
		await sessions.expectSessionCountToBe(0);
		await sessions.expectSessionListsToMatch();
		await variables.expectRuntimeToBe('None');
	});
});
