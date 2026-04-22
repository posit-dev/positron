/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Sessions: Delete', {
	tag: [tags.WEB, tags.WIN, tags.SESSIONS]
}, () => {

	test('Python - Validate can delete a single session', async function ({ sessions }) {
		await sessions.start(['python']);
		await sessions.expectSessionCountToBe(1);
		await sessions.deleteAll();
		await sessions.expectSessionCountToBe(0);
	});

	test('R - Validate can delete a single session', {
		tag: [tags.ARK]
	}, async function ({ sessions }) {
		await sessions.start(['r']);
		await sessions.expectSessionCountToBe(1);
		await sessions.deleteAll();
		await sessions.expectSessionCountToBe(0);
	});

	test('Validate session picker and variables after delete', {
		tag: [tags.VARIABLES]
	}, async function ({ app, sessions }) {
		const { console, variables } = app.workbench;
		await sessions.deleteAll();

		// Ensure sessions exist and are idle
		const [pySession, rSession] = await sessions.start(['python', 'r']);

		// Create variables in each session so we can verify which session the variables pane shows
		await sessions.select(pySession.id);
		await console.executeCode('Python', 'x = 1');
		await variables.expectVariableToBe('x', '1');

		await sessions.select(rSession.id);
		await console.executeCode('R', 'y <- 2');
		await variables.expectVariableToBe('y', '2');

		// Switch back to Python so it's the foreground session
		await sessions.select(pySession.id);
		await variables.expectVariableToBe('x', '1');

		// Delete Python session and verify the variables pane switches to R
		await sessions.delete(pySession.id);
		await sessions.expectSessionPickerToBe(rSession.name);
		await sessions.expectSessionCountToBe(1);
		await sessions.expectActiveSessionListsToMatch();
		await variables.expectVariableToBe('y', '2');
		await variables.expectVariableToNotExist('x');

		// Delete R session and verify no active sessions or variables
		await sessions.delete(rSession.id);
		await sessions.expectSessionPickerToBe('Start Session');
		await sessions.expectSessionCountToBe(0);
		await sessions.expectActiveSessionListsToMatch();
		await variables.expectVariableToNotExist('y');
	});

	test('Python & R - Validate can delete multiple sessions', async function ({ sessions }) {
		await sessions.start(['python', 'r', 'python', 'pythonAlt', 'pythonAlt', 'r', 'rAlt', 'rAlt']);
		await sessions.expectSessionCountToBe(8);
		await sessions.deleteAll();
		await sessions.expectSessionCountToBe(0);
	});
});
