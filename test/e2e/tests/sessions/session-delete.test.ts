/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Sessions: Delete', {
	tag: [tags.WEB, tags.CRITICAL, tags.WIN, tags.SESSIONS, tags.CRITICAL]
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
		const { variables } = app.positron;
		await sessions.deleteAll();

		// Ensure sessions exist and are idle
		const [pySession, rSession] = await sessions.start(['python', 'r']);

		// Delete 1st session and verify active sessions and runtime in session picker
		await sessions.delete(pySession.id);
		await sessions.expectSessionPickerToBe(rSession.name);
		await sessions.expectSessionCountToBe(1);
		await sessions.expectActiveSessionListsToMatch();
		await variables.expectRuntimeToBe('visible', rSession.name);

		// Delete 2nd session and verify no active sessions or runtime in session picker
		await sessions.delete(rSession.id);
		await sessions.expectSessionPickerToBe('Start Session');
		await sessions.expectSessionCountToBe(0);
		await sessions.expectActiveSessionListsToMatch();
		await variables.expectRuntimeToBe('not.visible', `${rSession.name}|${pySession.name}|None`);
	});

	test('Python & R - Validate can delete multiple sessions', async function ({ sessions }) {
		await sessions.start(['python', 'r', 'python', 'pythonAlt', 'pythonAlt', 'r', 'rAlt', 'rAlt']);
		await sessions.expectSessionCountToBe(8);
		await sessions.deleteAll();
		await sessions.expectSessionCountToBe(0);
	});
});
