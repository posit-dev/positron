/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Sessions: Session Picker', {
	tag: [tags.WEB, tags.CRITICAL, tags.WIN, tags.TOP_ACTION_BAR, tags.SESSIONS]
}, () => {

	test('Python - Start and verify session via session picker', async function ({ sessions }) {
		const pythonSession = await sessions.start('python', { triggerMode: 'session-picker' });

		await sessions.expectSessionPickerToBe(pythonSession);
		await sessions.expectAllSessionsToBeIdle();
	});

	test('R - Start and verify session via session picker', async function ({ sessions }) {
		const rSession = await sessions.start('r', { triggerMode: 'session-picker' });

		await sessions.expectSessionPickerToBe(rSession);
		await sessions.expectAllSessionsToBeIdle();
	});

	test('Verify Session Picker updates correctly across multiple active sessions', async function ({ sessions }) {
		// Start Python and R sessions
		const [pySession, rSession] = await sessions.start(['python', 'r'], { triggerMode: 'session-picker' });

		// Widen session tab list to view full runtime names
		await sessions.resizeSessionList({ x: -100 });

		// Start another Python session and verify Active Session Picker updates
		const pySessionAlt = await sessions.start('pythonAlt', { triggerMode: 'session-picker' });
		await expect(sessions.activeSessionPicker).toContainText(pySessionAlt.name);

		// Start another R session and verify Active Session Picker updates
		const rSessionAlt = await sessions.start('rAlt', { triggerMode: 'session-picker' });
		await expect(sessions.activeSessionPicker).toContainText(rSessionAlt.name);

		await sessions.select(rSession.id);
		await expect(sessions.activeSessionPicker).toContainText(rSession.name);

		await sessions.select(pySession.id);
		await expect(sessions.activeSessionPicker).toContainText(pySession.name);
	});
});
