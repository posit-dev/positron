/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { MetaData, SessionDetails } from '../../infra';
import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

const pythonSession: SessionDetails = {
	language: 'Python',
	version: process.env.POSITRON_PY_VER_SEL || ''
};
const rSession: SessionDetails = {
	language: 'R',
	version: process.env.POSITRON_R_VER_SEL || ''
};

const pythonMetaData: MetaData = {
	...pythonSession,
	state: 'idle',
	path: /Path:.*bin\/python/,
	source: 'Pyenv',
};

const rMetaData: MetaData = {
	...rSession,
	state: 'idle',
	path: /Path:.*bin\/R/,
	source: 'System',
};

test.use({
	suiteId: __filename
});

test.describe('Console: Sessions', {
	tag: [tags.WIN, tags.CONSOLE, tags.SESSIONS, tags.WEB]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test('Validate state between sessions (active, idle, disconnect) ', async function ({ app, interpreter }) {
		const console = app.workbench.console;
		await app.workbench.variables.toggleSecondarySideBar('hide');

		// Start Python session
		await interpreter.set('Python', false);

		// Verify Python session is visible and transitions from active --> idle
		await console.session.checkStatus(pythonSession, 'active');
		await console.session.checkStatus(pythonSession, 'idle');

		// Restart Python session and confirm state returns to active --> idle
		await console.session.restart(pythonSession, false);
		await console.session.checkStatus(pythonSession, 'active');
		await console.session.checkStatus(pythonSession, 'idle');

		// Start R session
		await interpreter.set('R', false);

		// Verify R session transitions from active --> idle while Python session remains idle
		await console.session.checkStatus(rSession, 'active');
		await console.session.checkStatus(rSession, 'idle');
		await console.session.checkStatus(pythonSession, 'idle');

		// Shutdown Python session, verify Python transitions to disconnected while R remains idle
		await console.session.shutdown(pythonSession, false);
		await console.session.checkStatus(pythonSession, 'disconnected');
		await console.session.checkStatus(rSession, 'idle');

		// Restart R session, verify R to returns to active --> idle and Python remains disconnected
		await console.session.restart(rSession, false);
		await console.session.checkStatus(rSession, 'active');
		await console.session.checkStatus(rSession, 'idle');
		await console.session.checkStatus(pythonSession, 'disconnected');

		// Shutdown R, verify both Python and R in disconnected state
		await console.session.shutdown(rSession, false);
		await console.session.checkStatus(rSession, 'disconnected');
		await console.session.checkStatus(pythonSession, 'disconnected');
	});

	test('Validate metadata between sessions', async function ({ app }) {
		const console = app.workbench.console;
		await app.workbench.variables.toggleSecondarySideBar('hide');

		// Ensure sessions exist and are idle
		await console.session.ensureStartedAndIdle(pythonSession);
		await console.session.ensureStartedAndIdle(rSession);

		// Verify Python session metadata
		await console.session.checkMetadata(pythonMetaData);
		await console.session.checkMetadata(rMetaData);

		// Shutdown Python session and verify metadata
		await console.session.shutdown(pythonSession);
		await console.session.checkMetadata({ ...pythonMetaData, state: 'exited' });

		// Shutdown R session and verify metadata
		await console.session.shutdown(rSession);
		await console.session.checkMetadata({ ...rMetaData, state: 'exited' });
	});

	test('Validate variables between sessions', {
		tag: [tags.VARIABLES]
	}, async function ({ app }) {
		const console = app.workbench.console;
		const variables = app.workbench.variables;

		// Ensure sessions exist and are idle
		await console.session.ensureStartedAndIdle(pythonSession);
		await console.session.ensureStartedAndIdle(rSession);

		// Set and verify variables in Python
		await console.session.select(pythonSession);
		await console.typeToConsole('x = 1', true);
		await console.typeToConsole('y = 2', true);
		await variables.checkRuntime(pythonSession);
		await variables.checkVariableValue('x', '1');
		await variables.checkVariableValue('y', '2');

		// Set and verify variables in R
		await console.session.select(rSession);
		await console.typeToConsole('x <- 3', true);
		await console.typeToConsole('z <- 4', true);
		await variables.checkRuntime(rSession);
		await variables.checkVariableValue('x', '3');
		await variables.checkVariableValue('z', '4');

		// Switch back to Python, update variables, and verify
		await console.session.select(pythonSession);
		await console.typeToConsole('x = 0', true);
		await variables.checkRuntime(pythonSession);
		await variables.checkVariableValue('x', '0');
		await variables.checkVariableValue('y', '2');

		// Switch back to R, verify variables remain unchanged
		await console.session.select(rSession);
		await variables.checkRuntime(rSession);
		await variables.checkVariableValue('x', '3');
		await variables.checkVariableValue('z', '4');
	});

	test('R - Validate editor problems reload with session restart', {
		tag: [tags.PROBLEMS]
	}, async function ({ app, page, openFile }) {
		await openFile('workspaces/fast-statement-execution/fast-execution.r');
		const console = app.workbench.console;
		const problems = app.workbench.problems;

		// Ensure R session exist and is idle
		await console.session.ensureStartedAndIdle(rSession);

		// Edit file to introduce a warning squiggly
		await test.step('Edit file to introduce warning squiggly', async () => {
			await page.getByText('x <- 1').dblclick();
			await app.code.driver.page.keyboard.type('<- 1a');
		});

		// Verify warning squiggly appears
		await expect(problems.warningSquiggly).toBeVisible();

		// Restart R session and verify warning squiggly re-appears
		await console.session.restart(rSession);
		await expect(problems.warningSquiggly).toBeVisible();
	});
});
