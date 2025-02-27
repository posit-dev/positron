/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';
import { Application, SessionInfo } from '../../infra';

const pythonSession: SessionInfo = {
	name: `Python ${process.env.POSITRON_PY_VER_SEL || ''}`,
	language: 'Python',
	version: process.env.POSITRON_PY_VER_SEL || ''
};
const rSession: SessionInfo = {
	name: `R ${process.env.POSITRON_R_VER_SEL || ''}`,
	language: 'R',
	version: process.env.POSITRON_R_VER_SEL || ''
};

test.use({
	suiteId: __filename
});

test.describe('Sessions', {
	tag: [tags.WIN, tags.WEB, tags.CONSOLE, tags.SESSIONS]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test.beforeEach(async function ({ app }) {
		await app.workbench.variables.togglePane('hide');
		pythonSession.id = await app.workbench.sessions.reuseSessionIfExists(pythonSession);
		rSession.id = await app.workbench.sessions.reuseSessionIfExists(rSession);
	});

	test('Validate can delete sessions', async function ({ app }) {
		const sessions = app.workbench.sessions;

		// Get all session ids
		const sessionIds = await sessions.getAllSessionIds();

		// Delete 1st session and verify active sessions
		await sessions.delete(sessionIds[0]);
		await expect(sessions.sessionTabs).toHaveCount(1);
		await verifySessionList(app, 1);

		// Delete 2nd session and verify no active sessions
		await sessions.delete(sessionIds[1]);
		await expect(sessions.chooseSessionButton).toBeVisible();
		await expect(sessions.sessionTabs).not.toBeVisible();

		// Verify no variables
		await app.workbench.variables.togglePane('show');
		// Verify no session in button
	});
});

async function verifySessionList(app: Application, count = 1) {
	await test.step('Verify active sessions match between console and session picker', async () => {
		await expect(async () => {
			const activeSessionsFromConsole = await app.workbench.sessions.getActiveSessions();
			const activeSessionsFromPicker = await app.workbench.sessions.quickPick.getActiveSessions();

			expect(activeSessionsFromConsole).toStrictEqual(activeSessionsFromPicker);
			if (count) {
				expect(activeSessionsFromConsole).toHaveLength(count);
			}
		}).toPass({ timeout: 10000 });
	});
}
