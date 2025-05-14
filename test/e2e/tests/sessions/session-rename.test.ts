/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Sessions: Rename', {
	tag: [tags.WIN, tags.CONSOLE, tags.SESSIONS, tags.CRITICAL],
	annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/7692' }],
}, () => {

	test.beforeEach(async function ({ app }) {
		await app.workbench.variables.togglePane('hide');
	});

	test('Validate can rename sessions and name persists', async function ({ sessions, runCommand }) {
		const [pySession, pySessionAlt, rSession, rSessionAlt] = await sessions.start(['python', 'pythonAlt', 'r', 'rAlt']);

		// Rename sessions
		await sessions.rename(pySession.name, 'Python Session 1');
		await sessions.rename(pySessionAlt.name, 'Python Session 2');
		await sessions.rename(rSession.name, 'R Session 1');
		await sessions.rename(rSessionAlt.name, 'R Session 2');

		// Reload window
		await runCommand('workbench.action.reloadWindow');
		await sessions.expectAllSessionsToBeReady();

		// Verify session names persist
		await sessions.expectSessionNameToBe(pySession.id, 'Python Session 1');
		await sessions.expectSessionNameToBe(pySessionAlt.id, 'Python Session 2');
		await sessions.expectSessionNameToBe(rSession.id, 'R Session 1');
		await sessions.expectSessionNameToBe(rSessionAlt.id, 'R Session 2');
	});

	test('Validate can rename sessions via UI', { tag: [tags.WEB_ONLY] }, async function ({ sessions },) {
		const [pySession, rSession] = await sessions.start(['python', 'r']);
		const newPyName = 'Pleasure meeting you here. 👋';
		const newRName = 'Hello, darling!';

		// Rename sessions
		await sessions.rename(pySession.name, newPyName);
		await sessions.rename(rSession.name, newRName);

		// Verify session names persist
		await sessions.expectSessionNameToBe(pySession.id, newPyName);
		await sessions.expectSessionNameToBe(rSession.id, newRName);
	});
});
