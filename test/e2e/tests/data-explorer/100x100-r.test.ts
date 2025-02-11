/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { join } from 'path';
import { parquetFilePath, testDataExplorer } from './helpers/100x100';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer 100x100', () => {
	test('R - verify data values in 100x100', {
		tag: [tags.WIN, tags.DATA_EXPLORER]
	}, async function ({ app, r }) {
		test.slow();

		// Test the data explorer.
		const dataFrameName = 'r100x100';
		await testDataExplorer(
			app,
			'R',
			[
				'library(arrow)',
				`${dataFrameName} <- read_parquet("${parquetFilePath(app)}")`,
			],
			dataFrameName,
			join(
				app.workspacePathOrFolder,
				'data-files',
				'100x100',
				'r-100x100.tsv'
			)
		);
	});
});
