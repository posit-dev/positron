/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

const PYTHON_VERSION = process.env.POSITRON_PY_VER_SEL || '';
const R_VERSION = process.env.POSITRON_R_VER_SEL || '';

test.use({
	suiteId: __filename
});

test.describe('Console: Session Behavior', {
	tag: [tags.WIN, tags.CONSOLE] // ISSUE tags.WEB does not work for now
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['positron.multipleConsoleSessions', 'true']], true);
	});

	test('Validate state (active, idle, disconnect) between sessions', async function ({ app, page, interpreter }) {
		const console = app.workbench.console;

		// Start Python session
		await interpreter.set('Python', false);

		// Verify Python session is visible and transitions from active --> idle
		await console.session.checkStatus('Python', PYTHON_VERSION, 'active');
		await console.session.checkStatus('Python', PYTHON_VERSION, 'idle');

		// Restart Python session and confirm state returns to active --> idle
		await console.session.restart('Python', PYTHON_VERSION);
		await console.session.checkStatus('Python', PYTHON_VERSION, 'active');
		await console.session.checkStatus('Python', PYTHON_VERSION, 'idle');

		// Start R session
		await interpreter.set('R', false);

		// Verify R session transitions from active --> idle while Python session remains idle
		await console.session.checkStatus('R', R_VERSION, 'active');
		await console.session.checkStatus('R', R_VERSION, 'idle');
		await console.session.checkStatus('Python', PYTHON_VERSION, 'idle');

		// Shutdown Python session, verify R remains idle while Python transitions to disconnected
		await console.session.shutdown('Python', PYTHON_VERSION);
		await console.session.checkStatus('R', R_VERSION, 'idle');
		await console.session.checkStatus('Python', PYTHON_VERSION, 'disconnected');

		// Restart R session, verify R to returns to active --> idle and Python remains disconnected
		await console.session.restart('R', R_VERSION);
		await console.session.checkStatus('R', R_VERSION, 'active');
		await console.session.checkStatus('R', R_VERSION, 'idle');
		await console.session.checkStatus('Python', PYTHON_VERSION, 'disconnected');

		// Shutdown R, verify both Python and R in disconnected state
		await console.session.shutdown('R', R_VERSION);
		await console.session.checkStatus('R', R_VERSION, 'disconnected');
		await console.session.checkStatus('Python', PYTHON_VERSION, 'disconnected');
	});

	test('Validate variables between sessions', async function ({ app }) {
		const console = app.workbench.console;
		const variables = app.workbench.variables;

		// Ensure sessions exist and are idle
		await console.session.ensureStartedAndIdle('Python', PYTHON_VERSION);
		await console.session.ensureStartedAndIdle('R', R_VERSION);

		// Set and verify variables in Python
		await console.session.select('Python', PYTHON_VERSION);
		await console.typeToConsole('x = 1', true);
		await console.typeToConsole('y = 2', true);
		await variables.checkRuntime('Python', PYTHON_VERSION);
		await variables.checkVariableValue('x', '1');
		await variables.checkVariableValue('y', '2');

		// Set and verify variables in R
		await console.session.select('R', R_VERSION);
		await console.typeToConsole('x <- 3', true);
		await console.typeToConsole('z <- 4', true);
		await variables.checkRuntime('R', R_VERSION);
		await variables.checkVariableValue('x', '3');
		await variables.checkVariableValue('z', '4');

		// Switch back to Python, update variables, and verify
		await console.session.select('Python', PYTHON_VERSION);
		await console.typeToConsole('x = 0', true);
		await variables.checkRuntime('Python', PYTHON_VERSION);
		await variables.checkVariableValue('x', '0');
		await variables.checkVariableValue('y', '2');

		// Switch back to R, verify variables remain unchanged
		await console.session.select('R', R_VERSION);
		await variables.checkRuntime('R', R_VERSION);
		await variables.checkVariableValue('x', '3');
		await variables.checkVariableValue('z', '4');
	});
});
