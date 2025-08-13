/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';
import { downloadFileFromS3, S3FileDownloadOptions } from '../../infra';

test.use({
	suiteId: __filename
});

// AWS Configuration
const region = "us-west-2";
const bucketName = "positron-qa-data-files";
const objectKey = "largeParquet.parquet";

const githubActions = process.env.GITHUB_ACTIONS === "true";

test.describe('Data Explorer - Very Large Data Frame', { tag: [tags.WIN, tags.DATA_EXPLORER, tags.PERFORMANCE] }, () => {
	test.beforeAll(async function ({ app }) {
		if (githubActions && process.platform !== 'win32') {
			const localFilePath = join(app.workspacePathOrFolder, "data-files", objectKey);
			const downloadOptions: S3FileDownloadOptions = {
				region: region,
				bucketName: bucketName,
				key: objectKey,
				localFilePath: localFilePath
			};
			await downloadFileFromS3(downloadOptions);
		}
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
		await hotKeys.showSecondarySidebar();
	});

	if (githubActions && process.platform !== 'win32') {

		test('Python - Verify data loads with very large unique data dataframe', async function ({ app, openFile, runCommand, python, metric }) {
			const { dataExplorer, variables, editors } = app.workbench;

			await openFile(join('workspaces', 'performance', 'loadBigParquet.py'));
			await runCommand('python.execInConsole');

			metric.start();

			await variables.doubleClickVariableRow('df');
			await editors.verifyTab('Data: df', { isVisible: true, isSelected: true });
			await dataExplorer.waitForTableToLoad();

			await metric.dataExplorer.stopAndSend({
				action: 'load_data',
				target_type: 'py.pandas.DataFrame',
				target_description: 'very large unique parquet',
				context_json: {
					data_rows: await dataExplorer.getRowCount(),
					data_cols: await dataExplorer.getColumnCount()
				}
			});
		});

		test('R - Verify data loads with very large unique data dataframe', async function ({ app, openFile, runCommand, r, metric }) {
			const { variables, editors, dataExplorer } = app.workbench;

			await openFile(join('workspaces', 'performance', 'loadBigParquet.r'));
			await runCommand('r.sourceCurrentFile');

			// Record how long it takes to load the data
			metric.start();
			await variables.doubleClickVariableRow('df2');
			await editors.verifyTab('Data: df2', { isVisible: true, isSelected: true });
			await dataExplorer.waitForTableToLoad();
			await metric.dataExplorer.stopAndSend({
				action: 'load_data',
				target_type: 'r.tibble',
				target_description: 'very_large_unique_parquet',
				context_json: {
					data_cols: await dataExplorer.getColumnCount(),
					data_rows: await dataExplorer.getRowCount()
				}
			});
		});

	} else {

		test('Python - Verify data loads with very large duplicated data dataframe', async function ({ app, openFile, runCommand, hotKeys, python, metric }) {
			const { dataExplorer, variables, editors } = app.workbench;

			await openFile(join('workspaces', 'performance', 'multiplyParquet.py'));
			await runCommand('python.execInConsole');

			metric.start();

			await variables.doubleClickVariableRow('df_large');
			await editors.verifyTab('Data: df_large', { isVisible: true, isSelected: true });
			await dataExplorer.getDataExplorerTableData();

			await metric.dataExplorer.stopAndSend({
				action: 'load_data',
				target_type: 'py.pandas.DataFrame',
				target_description: 'duplicated parquet with 1 mil rows 10 cols',
				context_json: {
					data_cols: await dataExplorer.getColumnCount(),
					data_rows: await dataExplorer.getRowCount()
				}
			});
		});

		test('R - Verify data loads with very large duplicated data dataframe', async function ({ app, openFile, runCommand, hotKeys, r, metric: logMetric }) {
			const { variables, editors, dataExplorer } = app.workbench;

			await openFile(join('workspaces', 'performance', 'multiplyParquet.r'));
			await runCommand('r.sourceCurrentFile');

			logMetric.start();
			await variables.doubleClickVariableRow('df3_large');
			await editors.verifyTab('Data: df3_large', { isVisible: true, isSelected: true });
			await hotKeys.closeSecondarySidebar();

			// awaits table load completion
			await dataExplorer.getDataExplorerTableData();
			await logMetric.dataExplorer.stopAndSend({
				action: 'load_data',
				target_type: 'r.tibble',
				target_description: 'duplicated parquet with 1 mil rows 10 cols',
				context_json: {
					data_cols: await dataExplorer.getColumnCount(),
					data_rows: await dataExplorer.getRowCount()
				}
			});
		});
	}
});
