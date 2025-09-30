/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';
import { TestTags } from '../../infra';
import { MetricTargetType } from '../../utils/metrics/index.js';

const LAST_CELL_CONTENTS = '2013-09-30 08:00:00';

test.use({
	suiteId: __filename
});

const testCases: Array<{ target: MetricTargetType; file: string; copyValue: string }> = [
	{ target: 'file.parquet', file: 'data-files/flights/flights.parquet', copyValue: '2013' },
	{ target: 'file.csv', file: 'data-files/flights/flights.csv', copyValue: '0' },
	{ target: 'file.csv.gz', file: 'data-files/flights/flights.csv.gz', copyValue: '0' },
	{ target: 'file.tsv', file: 'data-files/flights/flights.tsv', copyValue: '0' },
	{ target: 'file.tsv.gz', file: 'data-files/flights/flights.tsv.gz', copyValue: '0' },
	{ target: 'file.psv', file: 'data-files/flights/flights_piped.csv', copyValue: '0' }
];

const plainTextTestCases = [
	{ target: 'csv', file: 'flights.csv', searchString: ',year,month,day,dep_time,sched_dep_time,dep_delay,arr_time,sched_arr_time,arr_delay,carrier,flight,tailnum,origin,dest,air_time,distance,hour,minute,time_hour' },
	{ target: 'tsv', file: 'flights.tsv', searchString: /\s+year\s+month\s+day\s+dep_time\s+sched_dep_time\s+dep_delay\s+arr_time\s+sched_arr_time\s+arr_delay\s+carrier\s+flight\s+tailnum\s+origin\s+dest\s+air_time\s+distance\s+hour\s+minute\s+time_hour/ },
	{ target: 'pipe csv', file: 'flights_piped.csv', searchString: '|year|month|day|dep_time|sched_dep_time|dep_delay|arr_time|sched_arr_time|arr_delay|carrier|flight|tailnum|origin|dest|air_time|distance|hour|minute|time_hour' }

];

test.describe('Headless Data Explorer', {
	tag: [tags.WEB, tags.DATA_EXPLORER, tags.DUCK_DB, tags.WIN]
}, () => {

	test.beforeEach(async function ({ hotKeys }) {
		await hotKeys.notebookLayout(); // Make data explorer larger
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
		await hotKeys.stackedLayout(); //return to default layout
	});

	testCases.forEach(({ target, file, copyValue }) => {
		test(`Verify can open and view data with large ${target} file`, { tag: [tags.PERFORMANCE] }, async function ({ app, openDataFile, metric }) {
			const { editors, dataExplorer, clipboard } = app.workbench;
			await openDataFile(file);

			await metric.dataExplorer.loadData(async () => {
				await editors.verifyTab(file.split('/').pop()!, { isVisible: true, isSelected: true });
				await dataExplorer.waitForIdle();
			}, target);

			// verify can copy data to clipboard
			await dataExplorer.grid.clickCell(0, 0);
			await clipboard.copy();
			await clipboard.expectClipboardTextToBe(copyValue);

			// verify all data loads
			await dataExplorer.grid.clickLowerRightCorner();
			await dataExplorer.grid.expectCellContentAtIndexToBe(LAST_CELL_CONTENTS);

			// verify action bar has correct buttons
			await dataExplorer.editorActionBar.expectToHaveButton('Open as Plain Text File', file.endsWith('.csv') || file.endsWith('.tsv'));
		});
	});

	plainTextTestCases.forEach(({ target, file, searchString }) => {
		test(`Verify can open ${target} file as plaintext`,
			{ tag: [TestTags.EDITOR_ACTION_BAR] }, async function ({ app, openDataFile }) {
				const { dataExplorer, editors } = app.workbench;

				await openDataFile(join(`data-files/flights/${file}`));
				await editors.verifyTab(file, { isVisible: true, isSelected: true });

				await dataExplorer.editorActionBar.expectToHaveButton('Open as Plain Text File', true);
				await dataExplorer.editorActionBar.verifyCanOpenAsPlaintext(searchString);
			});
	});

	test(`Verify can open parquet decimal data`, async function ({ app, openDataFile }) {
		const { editors, dataExplorer, clipboard } = app.workbench;

		await openDataFile(`data-files/misc-parquet/decimal_types.parquet`);
		await editors.verifyTab('decimal_types.parquet', { isVisible: true, isSelected: true });

		// verify can copy data to clipboard
		await dataExplorer.grid.clickCell(0, 0);
		await clipboard.copy();
		await clipboard.expectClipboardTextToBe('123456789012345.678');

		// verify all data loads
		await dataExplorer.grid.clickLowerRightCorner();
		await dataExplorer.grid.expectCellContentAtIndexToBe('5555555555', 15);
	});
});





