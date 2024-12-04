/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../../_test.setup';
import { join } from 'path';
import { parquetFilePath, testDataExplorer } from './helpers/100x100';

test.use({
	suiteId: __filename
});

test('Data Explorer 100x100 - Python - Polars [C674520]', { tag: ['@win'] }, async function ({ app, python }) {
	test.slow();

	const dataFrameName = 'polars100x100';
	await testDataExplorer(
		app,
		'Python',
		'>>>',
		[
			'import polars',
			`${dataFrameName} = polars.read_parquet("${parquetFilePath(app)}")`,
		],
		dataFrameName,
		join(app.workspacePathOrFolder, 'data-files', '100x100', 'polars-100x100.tsv')
	);
});

