/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Outline', {
	tag: [tags.WEB, tags.WIN, tags.OUTLINE]
}, () => {

	test('Python - Verify Outline Contents', async function ({ app, python, openFile }) {
		await openFile(join('workspaces', 'chinook-db-py', 'chinook-sqlite.py'));
		await app.workbench.outline.expectOutlineToContain([
			'data_file_pathdata_file_path = os.path.join(os.getcwd(), \'data-files\', \'chinook\', \'chinook.db\')',
			'connconn = sqlite3.connect(data_file_path)',
			'curcur = conn.cursor()',
			'rowsrows = cur.fetchall()',
			'dfdf = pd.DataFrame(rows)'
		]);
	});

	test('R - Verify Outline Contents', async function ({ app, r, openFile }) {
		await openFile(join('workspaces', 'chinook-db-r', 'chinook-sqlite.r'));
		await app.workbench.outline.expectOutlineToContain([
			'con',
			'albums',
			'df',
		]);
	});
});



