/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Sessions: Session Picker', {
	tag: [tags.WEB, tags.CRITICAL, tags.WIN, tags.TOP_ACTION_BAR, tags.SESSIONS]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test('Python - Start and verify session via session picker', async function ({ sessions }) {
		const pythonSession = await sessions.start('python', { triggerMode: 'session-picker', reuse: false });

		await sessions.expectSessionPickerToBe(pythonSession.name);
		await sessions.expectAllSessionsToBeReady();
	});

	test('R - Start and verify session via session picker', async function ({ sessions }) {
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

	test('Verify Session Quickpick ranks sessions by last used', async function ({ sessions, page }) {
		// start two R sessions, select both to make sure they are most active
		const [rSession, rAltSession] = await sessions.start(['r', 'rAlt']);
		await sessions.select(rAltSession.id);
		await sessions.select(rSession.id);

		// open the session picker and verify the order
		await sessions.newSessionButton.click();
		await sessions.expectSessionQuickPickToContainAtIndex(0, rSession);
		await sessions.expectSessionQuickPickToContainAtIndex(1, rAltSession); // This fails here, it's Python from previous test
		await page.keyboard.press('Escape');

		// change the active session to the second session and verify it appears first in the session picker
		await sessions.select(rAltSession.id);
		await sessions.newSessionButton.click();
		await sessions.expectSessionQuickPickToContainAtIndex(0, rAltSession);
		await sessions.expectSessionQuickPickToContainAtIndex(1, rSession);
		await page.keyboard.press('Escape');

		// Switch back to the first session and verify it appears first in the session picker
		await sessions.select(rSession.id);
		await sessions.newSessionButton.click();
		await sessions.expectSessionQuickPickToContainAtIndex(0, rSession);
		await sessions.expectSessionQuickPickToContainAtIndex(1, rAltSession);
		await page.keyboard.press('Escape');
	});
});
