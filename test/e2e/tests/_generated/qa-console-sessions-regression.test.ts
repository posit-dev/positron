/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from './_qa.setup';

test.use({ suiteId: __filename });

test('QA: Console sessions regression - start, switch, restart', async function ({ app }) {
	const { sessions, console, variables } = app.workbench;

	// Start Python and verify code execution
	await sessions.start('python');
	await console.executeCode('Python', 'x = 42');
	await variables.expectVariableToBe('x', '42');
	await sessions.expectSessionCountToBe(1);

	// Start R and verify code execution
	await sessions.start('r');
	await console.executeCode('R', 'y <- 100');
	await variables.expectVariableToBe('y', '100');
	await sessions.expectSessionCountToBe(2);

	// Switch back to Python and verify state persists
	await sessions.select('Python');
	await console.waitForReady('>>>');
	await variables.expectVariableToBe('x', '42');

	// Restart Python and verify state is cleared
	await sessions.restart('Python');
	await console.waitForReadyAndRestarted('>>>');
	await variables.expectVariableToNotExist('x');

	// Verify session works after restart
	await console.executeCode('Python', 'z = 99');
	await variables.expectVariableToBe('z', '99');
	await sessions.expectSessionCountToBe(2);
});
