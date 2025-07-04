/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});


test.describe('Sessions: Accessibility',
	{ tag: [tags.WIN, tags.WEB, tags.ACCESSIBILITY, tags.SESSIONS, tags.CONSOLE] }, () => {
		test.beforeEach(async function ({ hotKeys }) {
			await hotKeys.closeSecondarySidebar();
		});

		test.afterEach(async function ({ sessions }) {
			await sessions.deleteDisconnectedSessions();
		});

		test('Validate session list is scrollable', async function ({ sessions }) {
			// @ts-ignore need a couple sessions for scrolling
			const [pySession, pySessionAlt] = await sessions.start(['python', 'pythonAlt']);

			// Resize window to force scrolling
			// Move the divider to be 100px above the bottom
			await sessions.setSessionDividerAboveBottom(100);
			await sessions.expectSessionListToBeScrollable({ horizontal: false, vertical: true });
			await sessions.setSessionDividerAboveBottom(500);

			// Cleaning up since next test only needs 2 sessions
			await sessions.delete(pySessionAlt.id);
		});

		test('Validate sessions are keyboard accessible', async function ({ sessions, page }) {
			const [pySession, rSession, pySession2] = await sessions.start(['python', 'r', 'python']);
			const newSessionName = 'This is a test';

			// Rename first session via keyboard actions
			await sessions.sessionTabs.first().click();
			await page.keyboard.press('ArrowDown');
			await page.keyboard.press('Enter');
			await page.keyboard.type(newSessionName);
			await page.keyboard.press('Enter');

			// Verify session name has been updated
			await sessions.expectSessionNameToBe(pySession.id, pySession.name);
			await sessions.expectSessionNameToBe(rSession.id, newSessionName);
			await sessions.expectSessionNameToBe(pySession2.id, pySession2.name);

			// Verify able to delete sessions via keyboard actions
			await sessions.expectSessionCountToBe(3);
			await page.keyboard.press('ArrowUp');
			await page.keyboard.press('Tab');
			await page.keyboard.press('Enter');
			await sessions.expectSessionCountToBe(2);
		});
	});
