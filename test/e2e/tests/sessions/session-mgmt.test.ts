/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { pythonSession, rSession, SessionInfo } from '../../infra';
import { expect } from '@playwright/test';

const pythonSession1: SessionInfo = { ...pythonSession };
const rSession1: SessionInfo = { ...rSession };

test.use({
	suiteId: __filename
});

test.describe('Sessions: Management', {
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

	test('Validate metadata between sessions', {
		annotation: [
			{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/6389' }]
	}, async function ({ app }) {
		const sessions = app.workbench.sessions;
		const console = app.workbench.console;

		// Ensure sessions exist and are idle
		pythonSession1.id = await sessions.reuseIdleSessionIfExists(pythonSession1);
		rSession1.id = await sessions.reuseIdleSessionIfExists(rSession1);

		// Verify Python session metadata
		await sessions.expectMetaDataToBe({ ...pythonSession1, state: 'idle' });
		await sessions.expectMetaDataToBe({ ...rSession1, state: 'idle' });

		// Shutdown Python session and verify metadata
		await sessions.select(pythonSession1.name);
		await console.typeToConsole('exit()', true);
		await sessions.expectMetaDataToBe({ ...pythonSession1, state: 'exited' });

		// Shutdown R session and verify metadata
		await sessions.select(rSession1.name);
		await console.typeToConsole('q()', true);
		await sessions.expectMetaDataToBe({ ...rSession1, state: 'exited' });
	});

	test('Validate variables between sessions', {
		tag: [tags.VARIABLES]
	}, async function ({ app }) {
		const sessions = app.workbench.sessions;
		const console = app.workbench.console;
		const variables = app.workbench.variables;

		// Ensure sessions exist and are idle
		pythonSession1.id = await sessions.reuseIdleSessionIfExists(pythonSession1);
		rSession1.id = await sessions.reuseIdleSessionIfExists(rSession1);

		// Set and verify variables in Python
		await sessions.select(pythonSession1.name);
		await console.typeToConsole('x = 1', true);
		await console.typeToConsole('y = 2', true);
		await variables.expectRuntimeToBe('visible', pythonSession1.name);
		await variables.expectVariableToBe('x', '1');
		await variables.expectVariableToBe('y', '2');

		// Set and verify variables in R
		await sessions.select(rSession1.name);
		await console.typeToConsole('x <- 3', true);
		await console.typeToConsole('z <- 4', true);
		await variables.expectRuntimeToBe('visible', rSession1.name);
		await variables.expectVariableToBe('x', '3');
		await variables.expectVariableToBe('z', '4');

		// Switch back to Python, update variables, and verify
		await sessions.select(pythonSession1.name);
		await console.typeToConsole('x = 0', true);
		await variables.expectRuntimeToBe('visible', pythonSession1.name);
		await variables.expectVariableToBe('x', '0');
		await variables.expectVariableToBe('y', '2');

		// Switch back to R, verify variables remain unchanged
		await sessions.select(rSession1.name);
		await variables.expectRuntimeToBe('visible', rSession1.name);
		await variables.expectVariableToBe('x', '3');
		await variables.expectVariableToBe('z', '4');
	});

	test('Validate active session list in console matches active session list in session picker', async function ({ app }) {
		const sessions = app.workbench.sessions;
		const console = app.workbench.console;

		// Start sessions and verify active sessions: order matters!
		pythonSession1.id = await sessions.reuseIdleSessionIfExists(pythonSession1);
		rSession1.id = await sessions.reuseIdleSessionIfExists(rSession1);
		await sessions.expectSessionCountToBe(2, 'active');
		await sessions.expectActiveSessionListsToMatch();

		// Shutdown Python session and verify active sessions
		await sessions.select(pythonSession1.name);
		await console.typeToConsole('exit()', true);
		await sessions.expectSessionCountToBe(1, 'active');
		await sessions.expectActiveSessionListsToMatch();

		// Shutdown R session and verify active sessions
		await sessions.select(rSession1.name);
		await console.typeToConsole('q()', true);
		await sessions.expectSessionCountToBe(0, 'active');
		await sessions.expectActiveSessionListsToMatch();

		// Launch Python session (again) and verify active sessions
		await sessions.deleteDisconnectedSessions();
		await sessions.launch(pythonSession1);
		await sessions.expectSessionCountToBe(1, 'active');
		await sessions.expectActiveSessionListsToMatch();
		// await console.barTrashButton.click();
		// await expect(sessions.activeSessionPicker).toHaveText('Start Session');
	});

	test('Validate can delete sessions', { tag: [tags.VARIABLES] }, async function ({ app }) {
		const sessions = app.workbench.sessions;
		const variables = app.workbench.variables;
		const console = app.workbench.console;

		// Ensure sessions exist and are idle
		pythonSession1.id = await sessions.reuseIdleSessionIfExists(pythonSession1);
		rSession1.id = await sessions.reuseIdleSessionIfExists(rSession1);

		// Delete 1st session and verify active sessions and runtime in session picker
		await sessions.delete(pythonSession1.name);
		await sessions.expectSessionCountToBe(1);
		await sessions.expectActiveSessionListsToMatch();
		await variables.expectRuntimeToBe('visible', rSession1.name);

		// Delete 2nd session and verify no active sessions or runtime in session picker
		await console.barTrashButton.click();
		await expect(sessions.activeSessionPicker).toHaveText('Start Session');
		await sessions.expectSessionCountToBe(0);
		await sessions.expectActiveSessionListsToMatch();
		await variables.expectRuntimeToBe('not.visible', `${rSession1.name}|${pythonSession1.name}|None`);
	});
});
