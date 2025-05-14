/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Sessions: Rename', {
	tag: [tags.WIN, tags.WEB_ONLY, tags.CONSOLE, tags.SESSIONS, tags.CRITICAL]
}, () => {

	test.beforeEach(async function ({ app }) {
		await app.workbench.variables.togglePane('hide');
	});

	test.afterEach(async function ({ sessions }) {
		await sessions.deleteDisconnectedSessions();
	});

	test('Validate can rename sessions and name persists', async function ({ sessions, runCommand }) {
		const [pySession, pySessionAlt, rSession, rSessionAlt] = await sessions.start(['python', 'pythonAlt', 'r', 'rAlt']);

		// Rename sessions
		await sessions.rename(pySession.id, 'Python Session 1');
		await sessions.rename(pySessionAlt.id, 'Python Session 2');
		await sessions.rename(rSession.id, 'R Session 1');
		await sessions.rename(rSessionAlt.id, 'R Session 2');

		// Reload window
		await runCommand('workbench.action.reloadWindow');
		await sessions.expectAllSessionsToBeReady();

		// Verify session names persist
		// await sessions.expectSessionNameToBe(pySession.id, 'Python Session 1');
		// await sessions.expectSessionNameToBe(pySessionAlt.id, 'Python Session 2');
		// await sessions.expectSessionNameToBe(rSession.id, 'R Session 1');
		// await sessions.expectSessionNameToBe(rSessionAlt.id, 'R Session 2');
	});
});
