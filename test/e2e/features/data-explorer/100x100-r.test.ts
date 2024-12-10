/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';
import { join } from 'path';
import { parquetFilePath, testDataExplorer } from './helpers/100x100';

test.use({
	suiteId: __filename
});

test('Data Explorer 100x100 - R [C674521]', { tag: ['@win', '@data-explorer'] }, async function ({ app, r }) {
	test.slow();

	// Test the data explorer.
	const dataFrameName = 'r100x100';
	await testDataExplorer(
		app,
		'R',
		'>',
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
