/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Variables: Sessions', {
	tag: [tags.WIN, tags.WEB, tags.CRITICAL, tags.VARIABLES, tags.SESSIONS, tags.CROSS_BROWSER]
}, () => {

	test.beforeEach(async function ({ hotKeys }) {
		await hotKeys.closeSecondarySidebar();
	});

	test.afterEach(async function ({ sessions }) {
		await sessions.deleteDisconnectedSessions();
	});

	test('Validate variables are isolated between sessions', async function ({ app, sessions }) {
		const { console, variables } = app.workbench;

		// Ensure sessions exist and are idle
		const [pySession, pySessionAlt, rSession] = await sessions.start(['python', 'pythonAlt', 'r']);

		// Set and verify variables in Python Session 1
		await sessions.select(pySession.id);
		await console.executeCode('Python', 'x = 1');
		await console.executeCode('Python', 'y = 2');
		await variables.expectRuntimeToBe('visible', pySession.name);
		await variables.expectVariableToBe('x', '1');
		await variables.expectVariableToBe('y', '2');

		// Set and verify variables in Python Session 2
		await sessions.select(pySessionAlt.id);
		await console.executeCode('Python', 'x = 11');
		await console.executeCode('Python', 'y = 22');
		await variables.expectRuntimeToBe('visible', pySessionAlt.name);
		await variables.expectVariableToBe('x', '11');
		await variables.expectVariableToBe('y', '22');

		// Set and verify variables in R
		await sessions.select(rSession.id);
		await console.executeCode('R', 'x <- 3');
		await console.executeCode('R', 'z <- 4');
		await variables.expectRuntimeToBe('visible', rSession.name);
		await variables.expectVariableToBe('x', '3');
		await variables.expectVariableToBe('z', '4');

		// Switch back to Python, update variables, and verify
		await sessions.select(pySession.id);
		await console.executeCode('Python', 'x = 0');
		await variables.expectRuntimeToBe('visible', pySession.name);
		await variables.expectVariableToBe('x', '0');
		await variables.expectVariableToBe('y', '2');

		// Switch back to R, verify variables remain unchanged
		await sessions.select(rSession.id);
		await variables.expectRuntimeToBe('visible', rSession.name);
		await variables.expectVariableToBe('x', '3');
		await variables.expectVariableToBe('z', '4');
	});
});
