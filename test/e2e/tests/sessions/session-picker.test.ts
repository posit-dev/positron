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

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test('Python - Start and verify session via session picker', async function ({ app, sessions }) {
		const session = app.workbench.sessions;

		const [pythonSession] = await sessions.start(['python'], { triggerMode: 'session-picker' });
		await session.expectSessionPickerToBe(pythonSession);
		const { state } = await session.getMetadata();
		expect(state).toBe('idle');
	});

	test('R - Start and verify session via session picker', async function ({ app, sessions }) {
		const session = app.workbench.sessions;

		const [rSession] = await sessions.start(['r'], { triggerMode: 'session-picker' });
		await session.expectSessionPickerToBe(rSession);
		const { state } = await session.getMetadata();
		expect(state).toBe('idle');
	});

	test('Verify Session Picker updates correctly across multiple active sessions', async function ({ app, sessions }) {
		const session = app.workbench.sessions;

		// Start Python and R sessions
		const [pythonSession1, rSession1] = await sessions.start(['python', 'r'], { triggerMode: 'session-picker' });

		// Widen session tab list to view full runtime names
		await session.resizeSessionList({ x: -100 });

		// Start another Python session and verify Active Session Picker updates
		const [pythonSession2] = await sessions.start(['pythonAlt'], { triggerMode: 'session-picker' });
		await expect(session.activeSessionPicker).toContainText(pythonSession2.name);

		// Start another R session and verify Active Session Picker updates
		const [rSession2] = await sessions.start(['rAlt'], { triggerMode: 'session-picker' });
		await expect(session.activeSessionPicker).toContainText(rSession2.name);

		await session.select(rSession1.id);
		await expect(session.activeSessionPicker).toContainText(rSession1.name);

		await session.select(pythonSession1.id);
		await expect(session.activeSessionPicker).toContainText(pythonSession1.name);
	});
});
