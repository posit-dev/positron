/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Outline #web #win', {
	tag: [tags.WEB, tags.WIN, tags.OUTLINE]
}, () => {

	test('Python - Verify Outline Contents', async function ({ app, python }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-py', 'chinook-sqlite.py'));
		const outlineData = await app.workbench.outline.getOutlineData();
		const expected = [
			'data_file_pathdata_file_path = os.path.join(os.getcwd(), \'data-files\', \'chinook\', \'chinook.db\')',
			'connconn = sqlite3.connect(data_file_path)',
			'curcur = conn.cursor()',
			'rowsrows = cur.fetchall()',
			'dfdf = pd.DataFrame(rows)'
		];

		const missingFromUI = expected.filter(item => !outlineData.includes(item));

		if (missingFromUI.length > 0) {
			console.log(`Missing from UI: ${missingFromUI}`);
		}
	});

	test('R - Verify Outline Contents', async function ({ app, r }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-r', 'chinook-sqlite.r'));
		const outlineData = await app.workbench.outline.getOutlineData();
		const expected = [
			'con',
			'albums',
			'df',
		];

		const missingFromUI = expected.filter(item => !outlineData.includes(item));

		if (missingFromUI.length > 0) {
			console.log(`Missing from UI: ${missingFromUI}`);
		}
	});
});



