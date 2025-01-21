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

test('Data Explorer 100x100 - Python - Pandas [C557563]', {
	tag: [tags.WIN, tags.DATA_EXPLORER]
}, async function ({ app, python }) {
	test.slow();

	const dataFrameName = 'pandas100x100';
	await testDataExplorer(
		app,
		'Python',
		[
			'import pandas as pd',
			`${dataFrameName} = pd.read_parquet("${parquetFilePath(app)}")`,
		],
		dataFrameName,
		join(app.workspacePathOrFolder, 'data-files', '100x100', 'pandas-100x100.tsv')
	);
});
