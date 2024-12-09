/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer - DuckDB Column Summary', {
	tag: ['@web', '@win', '@pr', '@data-explorer', '@duck-db']
}, () => {
	// python fixture not actually needed but serves as a long wait so that we can be sure
	// headless/duckdb open will work
	test('Verifies basic duckdb column summary functionality [C1053635]', async function ({ app, python }) {

		await app.workbench.positronQuickaccess.openDataFile(join(app.workspacePathOrFolder, 'data-files', '100x100', '100x100.parquet'));

		await app.workbench.positronLayouts.enterLayout('notebook');

		await test.step('Verify some column missing percentages', async () => {
			expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(1)).toBe('0%');
			expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(2)).toBe('0%');
			expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(3)).toBe('0%');
			expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(4)).toBe('0%');
			expect(await app.workbench.positronDataExplorer.getColumnMissingPercent(5)).toBe('0%');
		});

		await test.step('Verify some column profile info', async () => {
			const col1ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(1);
			expect(col1ProfileInfo.profileData).toStrictEqual({
				'Missing': '0',
				'Min': '0',
				'Median': '0',
				'Mean': '0',
				'Max': '0',
				'SD': '0'
			});
			expect(col1ProfileInfo.profileSparklineHeights).toStrictEqual(['50.0']);

			const col2ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(2);
			expect(col2ProfileInfo.profileData).toStrictEqual({
				'Missing': '0',
				'Empty': '0',
				'Unique': '100'
			});
			expect(col2ProfileInfo.profileSparklineHeights).toStrictEqual([
				'1.0',
				'1.0',
				'1.0',
				'1.0',
				'1.0',
				'1.0',
				'1.0',
				'1.0',
				'1.0',
				'1.0',
				'1.0',
				'1.0',
				'1.0',
				'1.0',
				'1.0',
				'1.0',
				'50.0',
			]);

			const col3ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(3);
			expect(col3ProfileInfo.profileData).toStrictEqual({
				'Missing': '0',
				'True': '46',
				'False': '54'
			});
			expect(col3ProfileInfo.profileSparklineHeights).toStrictEqual(['50.0', '42.6']);

			const col4ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(4);
			expect(col4ProfileInfo.profileData).toStrictEqual({
				'Missing': '0',
				'Min': '-125',
				'Median': '-11',
				'Mean': '-2.71',
				'Max': '126',
				'SD': '75.02'
			});
			expect(col4ProfileInfo.profileSparklineHeights).toStrictEqual([
				'44.0',
				'50.0',
				'36.0',
				'44.0',
				'0.0',
			]);

			const col5ProfileInfo = await app.workbench.positronDataExplorer.getColumnProfileInfo(5);
			expect(col5ProfileInfo.profileData).toStrictEqual({
				'Missing': '0',
				'Min': '-32403',
				'Median': '-1357.50',
				'Mean': '2138.13',
				'Max': '32721',
				'SD': '18186.19'
			});
			expect(col5ProfileInfo.profileSparklineHeights).toStrictEqual([
				'28.3',
				'47.8',
				'50.0',
				'43.5',
				'0.0',
			]);
		});

		await app.workbench.positronLayouts.enterLayout('stacked');
		await app.workbench.positronSideBar.closeSecondarySideBar();

		await app.workbench.positronDataExplorer.closeDataExplorer();
		await app.workbench.positronVariables.toggleVariablesView();

	});
});
