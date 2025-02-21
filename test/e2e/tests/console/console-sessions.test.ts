/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { SessionDetails } from '../../infra';
import { test, tags } from '../_test.setup';

const pythonSession: SessionDetails = {
	language: 'Python',
	version: process.env.POSITRON_PY_VER_SEL || ''
};
const rSession: SessionDetails = {
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

	test('Validate state between sessions (active, idle, disconnect) ', async function ({ app, interpreter }) {
		const console = app.workbench.console;

		// Start Python session
		await app.workbench.console.startSession({ ...pythonSession, waitForReady: false });

		// Verify Python session is visible and transitions from active --> idle
		await console.session.checkStatus(pythonSession, 'active');
		await console.session.checkStatus(pythonSession, 'idle');

		// Restart Python session and confirm state returns to active --> idle
		await console.session.restart(pythonSession, false);
		await console.session.checkStatus(pythonSession, 'active');
		await console.session.checkStatus(pythonSession, 'idle');

		// Start R session
		await app.workbench.console.startSession({ ...rSession, waitForReady: false });

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

	test('Validate session state displays as active when executing code', async function ({ app }) {
		const console = app.workbench.console;

		// Ensure sessions exist and are idle
		await console.session.ensureStartedAndIdle(pythonSession);
		await console.session.ensureStartedAndIdle(rSession);

		// Verify Python session transitions to active when executing code
		await console.session.select(pythonSession);
		await console.typeToConsole('import time', true);
		await console.typeToConsole('time.sleep(1)', true);
		await console.session.checkStatus(pythonSession, 'active');
		await console.session.checkStatus(pythonSession, 'idle');

		// Verify R session transitions to active when executing code
		await console.session.select(rSession);
		await console.typeToConsole('Sys.sleep(1)', true);
		await console.session.checkStatus(rSession, 'active');
		await console.session.checkStatus(pythonSession, 'idle');
	});

	test('Validate metadata between sessions', {
		annotation: [
			{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/6389' }]
	}, async function ({ app }) {
		const console = app.workbench.console;

		// Ensure sessions exist and are idle
		await console.session.ensureStartedAndIdle(pythonSession);
		await console.session.ensureStartedAndIdle(rSession);

		// Verify Python session metadata
		await console.session.checkMetadata({ ...pythonSession, state: 'idle' });
		await console.session.checkMetadata({ ...rSession, state: 'idle' });

		// Shutdown Python session and verify metadata
		await console.session.shutdown(pythonSession);
		await console.session.checkMetadata({ ...pythonSession, state: 'exited' });

		// Shutdown R session and verify metadata
		await console.session.shutdown(rSession);
		await console.session.checkMetadata({ ...rSession, state: 'exited' });
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
});
