/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
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

		test('Python - Verify data loads with very large unique data dataframe', async function ({ app, logger, openFile, runCommand, hotKeys, python, logMetric }) {
			const { dataExplorer, variables, editors } = app.workbench;

			await openFile(join('workspaces', 'performance', 'loadBigParquet.py'));
			await runCommand('python.execInConsole');

			logMetric.start();
			const startTime = performance.now();

			await variables.doubleClickVariableRow('df');
			await editors.verifyTab('Data: df', { isVisible: true, isSelected: true });
			await hotKeys.closeSecondarySidebar();

			// awaits table load completion
			await dataExplorer.getDataExplorerTableData();
			const endTime = performance.now();
			const timeTaken = endTime - startTime;

			await logMetric.stopAndSend({
				feature_area: 'data_explorer',
				action: 'load_data',
				target_type: 'pandas.DataFrame',
				target_description: 'very large unique parquet'
			});

			if (timeTaken > 40000) {
				fail(`Opening large unique parquet took ${timeTaken} milliseconds (pandas)`);
			} else {
				logger.log(`Opening large unique parquet took ${timeTaken} milliseconds (pandas)`);
			}
		});

		test('R - Verify data loads with very large unique data dataframe', async function ({ app, logger, openFile, runCommand, hotKeys, r, logMetric }) {
			const { variables, editors, dataExplorer } = app.workbench;

			await openFile(join('workspaces', 'performance', 'loadBigParquet.r'));
			await runCommand('r.sourceCurrentFile');

			logMetric.start();
			const startTime = performance.now();

			await variables.doubleClickVariableRow('df2');
			await editors.verifyTab('Data: df2', { isVisible: true, isSelected: true });
			await hotKeys.closeSecondarySidebar();

			// awaits table load completion
			await dataExplorer.getDataExplorerTableData();
			const endTime = performance.now();
			const timeTaken = endTime - startTime;

			await logMetric.stopAndSend({
				feature_area: 'data_explorer',
				action: 'data_load',
				target_type: 'data.frame',
				target_description: 'very_large_unique_parquet'
			});

			if (timeTaken > 75000) {
				fail(`Opening large unique parquet took ${timeTaken} milliseconds (R)`);
			} else {
				logger.log(`Opening large unique parquet took ${timeTaken} milliseconds (R)`);
			}
		});

	} else {

		test('Python - Verify data loads with very large duplicated data dataframe', async function ({ app, logger, openFile, runCommand, hotKeys, python, logMetric }) {
			const { dataExplorer, variables, editors } = app.workbench;

			await openFile(join('workspaces', 'performance', 'multiplyParquet.py'));
			await runCommand('python.execInConsole');

			logMetric.start();

			await variables.doubleClickVariableRow('df_large');
			await editors.verifyTab('Data: df_large', { isVisible: true, isSelected: true });
			await hotKeys.closeSecondarySidebar();

			// awaits table load completion
			await dataExplorer.getDataExplorerTableData();

			await logMetric.stopAndSend({
				feature_area: 'data_explorer',
				action: 'load_data',
				target_type: 'pandas.DataFrame',
				target_description: 'duplicated parquet with 1 mil rows 10 cols',
				context_json: {
					data_cols: 10,
					data_rows: 1000000
				}
			});
		});

		test('R - Verify data loads with very large duplicated data dataframe', async function ({ app, logger, openFile, runCommand, hotKeys, r, logMetric }) {
			const { variables, editors, dataExplorer } = app.workbench;

			await openFile(join('workspaces', 'performance', 'multiplyParquet.r'));
			await runCommand('r.sourceCurrentFile');

			logMetric.start();

			await variables.doubleClickVariableRow('df3_large');
			await editors.verifyTab('Data: df3_large', { isVisible: true, isSelected: true });
			await hotKeys.closeSecondarySidebar();

			// awaits table load completion
			await dataExplorer.getDataExplorerTableData();

			await logMetric.stopAndSend({
				feature_area: 'data_explorer',
				action: 'load_data',
				target_type: 'data.frame',
				target_description: 'duplicated parquet with 1 mil rows 10 cols',
				context_json: {
					data_cols: 10,
					data_rows: 1000000
				}
			});
		});
	}
});
