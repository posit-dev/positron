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

test.describe('Console: Session List', {
	tag: [tags.WEB, tags.WIN, tags.CONSOLE]
}, () => {
	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['positron.multipleConsoleSessions', 'true']], true);
	});

	test('Validate session state (active, idle, disconnect) transitions for R and Python', async function ({ app, page, interpreter }) {
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
});
