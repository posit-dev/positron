/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.afterEach(async function ({ hotKeys }) {
	await hotKeys.closeAllEditors();
});

test.describe('Data Explorer - DuckDB Column Summary', {
	tag: [tags.WEB, tags.WIN, tags.CRITICAL, tags.DATA_EXPLORER, tags.DUCK_DB]
}, () => {
	test('Verify basic duckdb column summary functionality', async function ({ app, openDataFile, hotKeys }) {
		const { summaryPanel } = app.workbench.dataExplorer;

		await openDataFile('data-files/100x100/100x100.parquet');
		await hotKeys.notebookLayout();

		await summaryPanel.show();
		await summaryPanel.verifyMissingPercent([
			{ column: 1, expected: '0%' },
			{ column: 2, expected: '0%' },
			{ column: 3, expected: '0%' },
			{ column: 4, expected: '0%' },
			{ column: 5, expected: '0%' }
		]);
		await summaryPanel.verifyColumnData([
			{ column: 1, expected: { 'Missing': '0', 'Min': '0', 'Median': '0', 'Mean': '0', 'Max': '0', 'SD': '0' } },
			{ column: 2, expected: { 'Missing': '0', 'Empty': '0', 'Unique': '100' } },
			{ column: 3, expected: { 'Missing': '0', 'True': '46', 'False': '54' } },
			{ column: 4, expected: { 'Missing': '0', 'Min': '-125', 'Median': '-11', 'Mean': '-2.71', 'Max': '126', 'SD': '75.02' } },
			{ column: 5, expected: { 'Missing': '0', 'Min': '-32403', 'Median': '-1357', 'Mean': '2138.13', 'Max': '32721', 'SD': '18186.19' } }
		]);
		await summaryPanel.verifySparklineHeights([
			{ column: 1, expected: ['50.0'] },
			{
				column: 2, expected: [
					'1.0', '1.0', '1.0', '1.0', '1.0',
					'1.0', '1.0', '1.0', '1.0', '1.0',
					'1.0', '1.0', '1.0', '1.0', '1.0',
					'1.0', '50.0'
				]
			},
			{ column: 3, expected: ['50.0', '42.6'] },
			{ column: 4, expected: ['44.0', '50.0', '36.0', '44.0', '26.0'] },
			{ column: 5, expected: ['28.3', '47.8', '50.0', '43.5', '47.8'] }
		]);
	});
});
