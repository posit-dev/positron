/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, SessionMetaData } from '../../infra/index.js';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Session Picker', {
	tag: [tags.WEB, tags.CRITICAL, tags.WIN, tags.TOP_ACTION_BAR, tags.SESSIONS]
}, () => {

	test('Python - Start and verify session via session picker', async function ({ sessions }) {
		const pythonSession = await sessions.start('python', { triggerMode: 'session-picker', reuse: false });

		await sessions.expectSessionPickerToBe(pythonSession.name);
		await sessions.expectAllSessionsToBeReady();
	});

	test('R - Start and verify session via session picker', {
		tag: [tags.ARK]
	}, async function ({ sessions }) {
		const rSession = await sessions.start('r', { triggerMode: 'session-picker', reuse: false });

		await sessions.expectSessionPickerToBe(rSession.name);
		await sessions.expectAllSessionsToBeReady();
	});

	test('Verify Session Picker updates correctly across multiple active sessions', async function ({ sessions }) {
		// Start Python and R sessions
		const [pySession, rSession] = await sessions.start(['python', 'r']);

		// Widen session tab list to view full runtime names
		await sessions.resizeSessionList({ x: -100 });

		// Start another Python session and verify Active Session Picker updates
		const pySessionAlt = await sessions.start('pythonAlt', { triggerMode: 'session-picker', reuse: false });
		await sessions.expectSessionPickerToBe(pySessionAlt.name);

		// Start another R session and verify Active Session Picker updates
		const rSessionAlt = await sessions.start('rAlt', { triggerMode: 'session-picker', reuse: false });
		await sessions.expectSessionPickerToBe(rSessionAlt.name);

		await sessions.select(rSession.id);
		await sessions.expectSessionPickerToBe(rSession.name);

		await sessions.select(pySession.id);
		await sessions.expectSessionPickerToBe(pySession.name);
	});

	test('Verify Session Quickpick ranks sessions by last used', async function ({ app, page }) {
		const { sessions } = app.positron;
		const [rSession, rAltSession] = await sessions.start(['r', 'rAlt']);

		// run code in both sessions to mark them as recently used
		await executeCodeInSession(app, rAltSession);
		await executeCodeInSession(app, rSession);
		await sessions.expectSessionQuickPickToContainInRelativeOrder([
			{ session: rSession },
			{ session: rAltSession }
		]);

		// run code in the second session and verify it appears first in the quick pick
		await executeCodeInSession(app, rAltSession);
		await sessions.expectSessionQuickPickToContainInRelativeOrder([
			{ session: rAltSession },
			{ session: rSession }
		]);

		// run code in a new python session and verify the updated order
		const pySession = await sessions.start('python');
		await executeCodeInSession(app, pySession);
		await sessions.expectSessionQuickPickToContainInRelativeOrder([
			{ session: pySession },
			{ session: rAltSession },
			{ session: rSession }
		]);
	});
});

async function executeCodeInSession(app: Application, session: SessionMetaData) {
	const { console, sessions } = app.positron;

	await sessions.select(session.id);
	await console.executeCode(session.name.includes('Python') ? 'Python' : 'R', '1+1', { maximizeConsole: false });
}
