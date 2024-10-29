/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { join } from 'path';
import { Application, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { setupAndStartApp } from '../../../test-runner/test-hooks';


describe('Outline #web #win', () => {
	setupAndStartApp();

	describe('Outline Test - Python', () => {
		before(async function () {
			await PositronPythonFixtures.SetupFixtures(this.app as Application);
		});

		it('Python - Verify Outline Contents [C956870]', async function () {
			const app = this.app as Application;
			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-py', 'chinook-sqlite.py'));

			const outlineData = await app.workbench.positronOutline.getOutlineData();

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
	});



	describe('Outline Test - R', () => {
		before(async function () {
			await PositronRFixtures.SetupFixtures(this.app as Application);
		});

		it('R - Verify Outline Contents [C956871]', async function () {
			const app = this.app as Application;
			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-r', 'chinook-sqlite.r'));

			const outlineData = await app.workbench.positronOutline.getOutlineData();

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
});


