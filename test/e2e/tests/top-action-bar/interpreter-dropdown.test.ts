/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { SessionDetails } from '../../infra';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

const pythonSession: SessionDetails = {
	language: 'Python',
	version: process.env.POSITRON_PY_VER_SEL || ''
};
const rSession: SessionDetails = {
	language: 'R',
	version: process.env.POSITRON_R_VER_SEL || ''
};

test.describe('Top Action Bar - Interpreter Dropdown', {
	tag: [tags.WEB, tags.CRITICAL, tags.WIN, tags.TOP_ACTION_BAR, tags.SESSIONS]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test('Python - Verify interpreter starts and displays as running', async function ({ app }) {
		await app.workbench.console.selectInterpreterNew({ ...pythonSession, triggerMode: 'dropdown' });
		await app.workbench.interpreterNew.verifyInterpreterIsSelected(pythonSession);
		await app.workbench.console.session.checkStatus(pythonSession, 'idle');
	});

	test('R - Verify interpreter starts and displays as running', async function ({ app }) {
		await app.workbench.console.selectInterpreterNew({ ...rSession, triggerMode: 'dropdown' });
		await app.workbench.interpreterNew.verifyInterpreterIsSelected(rSession);
		await app.workbench.console.session.checkStatus(rSession, 'idle');
	});
});
