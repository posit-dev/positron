/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { SessionName } from '../../infra';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

const pythonSession: SessionName = {
	language: 'Python',
	version: process.env.POSITRON_PY_VER_SEL || ''
};
const rSession: SessionName = {
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
		await app.workbench.sessions.launch({ ...pythonSession, triggerMode: 'top-action-bar' });
		await app.workbench.sessions.verifySessionPickerValue(pythonSession);
		await app.workbench.sessions.checkStatus(pythonSession, 'idle');
	});

	test('R - Verify session starts and displays as running', async function ({ app }) {
		await app.workbench.sessions.launch({ ...rSession, triggerMode: 'top-action-bar' });
		await app.workbench.sessions.verifySessionPickerValue(rSession);
		await app.workbench.sessions.checkStatus(rSession, 'idle');
	});
});
