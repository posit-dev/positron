/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { join } from 'path';

test.use({
	suiteId: __filename
});

test.describe('Problems', {
	tag: [tags.DEBUG, tags.WEB, tags.WIN]
}, () => {

	test('Python - Verify Problems Functionality [C...]', { tag: [tags.WIN] }, async function ({ app, python, openFile }) {

		await test.step('Open file and add bad character', async () => {
			await openFile(join('workspaces', 'chinook-db-py', 'chinook-sqlite.py'));

			await app.code.wait(10000);

			await app.workbench.editor.clickOnTerm('chinook-sqlite.py', 'row', 9);

			await app.code.wait(60000);

		});
	});
});
