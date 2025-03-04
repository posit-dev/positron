/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { pythonSession, pythonSessionAlt, rSession, rSessionAlt, SessionInfo } from '../../infra';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

const pythonSession1: SessionInfo = { ...pythonSession, triggerMode: 'session-picker' };
const pythonSession2: SessionInfo = { ...pythonSessionAlt, triggerMode: 'session-picker' };
const rSession1: SessionInfo = { ...rSession, triggerMode: 'session-picker' };
const rSession2: SessionInfo = { ...rSessionAlt, triggerMode: 'session-picker' };

test.describe('Sessions: Session Picker', {
	tag: [tags.WEB, tags.CRITICAL, tags.WIN, tags.TOP_ACTION_BAR, tags.SESSIONS]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test('Python - Start and verify session via session picker', async function ({ app }) {
		const sessions = app.workbench.sessions;

		pythonSession.id = await sessions.launch(pythonSession);
		await sessions.expectSessionPickerToBe(pythonSession);
		const { state } = await sessions.getMetadata();
		expect(state).toBe('idle');
	});

	test('R - Start and verify session via session picker', async function ({ app }) {
		const sessions = app.workbench.sessions;

		rSession1.id = await sessions.launch(rSession);
		await sessions.expectSessionPickerToBe(rSession);
		const { state } = await sessions.getMetadata();
		expect(state).toBe('idle');
	});

	test('Verify Session Picker updates correctly across multiple active sessions', async function ({ app }) {
		const sessions = app.workbench.sessions;

		pythonSession1.id = await sessions.reuseSessionIfExists(pythonSession1);
		rSession1.id = await sessions.reuseSessionIfExists(rSession1);

		// Widen session tab list to view full runtime names
		await sessions.widenSessionTabList();

		// Verify Active Session Picker is accurate when selecting different sessions
		pythonSession2.id = await sessions.launch(pythonSession2);
		await expect(sessions.activeSessionPicker).toContainText(pythonSession2.name);

		rSession2.id = await sessions.launch(rSession2);
		await expect(sessions.activeSessionPicker).toContainText(rSession2.name);

		await sessions.select(rSession1.id);
		await expect(sessions.activeSessionPicker).toContainText(rSession1.name);

		await sessions.select(pythonSession1.id);
		await expect(sessions.activeSessionPicker).toContainText(pythonSession1.name);
	});
});
