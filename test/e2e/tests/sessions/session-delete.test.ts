/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Sessions: Delete', {
	tag: [tags.WEB, tags.CRITICAL, tags.WIN, tags.TOP_ACTION_BAR, tags.SESSIONS]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test('Python - delete multiple sessions', async function ({ sessions }) {
		await sessions.start(['python', 'python', 'pythonAlt', 'pythonAlt']);
		await sessions.expectSessionCountToBe(4);
		await sessions.deleteAll();
		await sessions.expectSessionCountToBe(0);
	});

	test('R - delete multiple sessions', async function ({ sessions }) {
		await sessions.start(['r', 'r', 'rAlt', 'rAlt']);
		await sessions.expectSessionCountToBe(4);
		await sessions.deleteAll();
		await sessions.expectSessionCountToBe(0);
	});
});
