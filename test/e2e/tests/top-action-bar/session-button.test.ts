/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { SessionInfo } from '../../infra';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

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

test.describe('Top Action Bar: Session Button', {
	tag: [tags.WEB, tags.CRITICAL, tags.WIN, tags.TOP_ACTION_BAR, tags.SESSIONS]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test('Python - Verify session starts and displays as running', async function ({ app }) {
		const sessions = app.workbench.sessions;

		pythonSession.id = await sessions.launch({ ...pythonSession, triggerMode: 'session-picker' });
		await sessions.expectSessionPickerToBe(pythonSession);
		const { state } = await sessions.getMetadata();
		expect(state).toBe('idle');
	});

	test('R - Verify session starts and displays as running', async function ({ app }) {
		const sessions = app.workbench.sessions;

		rSession.id = await sessions.launch({ ...rSession, triggerMode: 'session-picker' });
		await sessions.expectSessionPickerToBe(rSession);
		const { state } = await sessions.getMetadata();
		expect(state).toBe('idle');
	});
});
