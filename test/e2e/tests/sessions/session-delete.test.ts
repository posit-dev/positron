/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Sessions: Delete', {
	tag: [tags.WEB, tags.CRITICAL, tags.WIN, tags.SESSIONS]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test('Python - Validate can delete a single session', async function ({ sessions }) {
		await sessions.start(['python']);
		await sessions.expectSessionCountToBe(1);
		await sessions.deleteAll();
		await sessions.expectSessionCountToBe(0);
	});

	test('R - Validate can delete a single session', async function ({ sessions }) {
		await sessions.start(['r']);
		await sessions.expectSessionCountToBe(1);
		await sessions.deleteAll();
		await sessions.expectSessionCountToBe(0);
	});

	test('Python & R - Validate can delete multiple sessions', async function ({ sessions }) {
		await sessions.start(['python', 'r', 'python', 'pythonAlt', 'pythonAlt', 'r', 'rAlt', 'rAlt']);
		await sessions.expectSessionCountToBe(8);
		await sessions.deleteAll();
		await sessions.expectSessionCountToBe(0);
	});
});
