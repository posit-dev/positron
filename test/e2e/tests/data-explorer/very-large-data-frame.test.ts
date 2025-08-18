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

test.describe('Data Explorer - Very Large Data Frame', { tag: [tags.WIN, tags.DATA_EXPLORER] }, () => {
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

		test('Python - Verify data loads with very large unique data dataframe', async function ({ app, logger, openFile, runCommand, hotKeys, python }) {
			const { dataExplorer, variables, editors } = app.workbench;

			await openFile(join('workspaces', 'performance', 'loadBigParquet.py'));
			await runCommand('python.execInConsole');
			const startTime = performance.now();

			await variables.doubleClickVariableRow('df');
			await editors.verifyTab('Data: df', { isVisible: true, isSelected: true });
			await hotKeys.closeSecondarySidebar();

			// awaits table load completion
			await dataExplorer.grid.getData();
			const endTime = performance.now();
			const timeTaken = endTime - startTime;

			if (timeTaken > 40000) {
				fail(`Opening large unique parquet took ${timeTaken} milliseconds (pandas)`);
			} else {
				logger.log(`Opening large unique parquet took ${timeTaken} milliseconds (pandas)`);
			}
		});

		test('R - Verify data loads with very large unique data dataframe', async function ({ app, logger, openFile, runCommand, hotKeys, r }) {
			const { variables, editors, dataExplorer } = app.workbench;

			await openFile(join('workspaces', 'performance', 'loadBigParquet.r'));
			await runCommand('r.sourceCurrentFile');
			const startTime = performance.now();

			await variables.doubleClickVariableRow('df2');
			await editors.verifyTab('Data: df2', { isVisible: true, isSelected: true });
			await hotKeys.closeSecondarySidebar();

			// awaits table load completion
			await dataExplorer.grid.getData();
			const endTime = performance.now();
			const timeTaken = endTime - startTime;

			if (timeTaken > 75000) {
				fail(`Opening large unique parquet took ${timeTaken} milliseconds (R)`);
			} else {
				logger.log(`Opening large unique parquet took ${timeTaken} milliseconds (R)`);
			}
		});

	} else {

		test('Python - Verify data loads with very large duplicated data dataframe', async function ({ app, logger, openFile, runCommand, hotKeys, python }) {
			const { dataExplorer, variables, editors } = app.workbench;

			await openFile(join('workspaces', 'performance', 'multiplyParquet.py'));
			await runCommand('python.execInConsole');
			const startTime = performance.now();

			await variables.doubleClickVariableRow('df_large');
			await editors.verifyTab('Data: df_large', { isVisible: true, isSelected: true });
			await hotKeys.closeSecondarySidebar();

			// awaits table load completion
			await dataExplorer.grid.getData();
			const endTime = performance.now();
			const timeTaken = endTime - startTime;

			if (timeTaken > 27000) {
				fail(`Opening large duplicated parquet took ${timeTaken} milliseconds (pandas)`);
			} else {
				logger.log(`Opening large duplicated parquet took ${timeTaken} milliseconds (pandas)`);
			}
		});

		test('R - Verify data loads with very large duplicated data dataframe', async function ({ app, logger, openFile, runCommand, hotKeys, r }) {
			const { variables, editors, dataExplorer } = app.workbench;

			await openFile(join('workspaces', 'performance', 'multiplyParquet.r'));
			await runCommand('r.sourceCurrentFile');
			const startTime = performance.now();

			await variables.doubleClickVariableRow('df3_large');
			await editors.verifyTab('Data: df3_large', { isVisible: true, isSelected: true });
			await hotKeys.closeSecondarySidebar();

			// awaits table load completion
			await dataExplorer.grid.getData();
			const endTime = performance.now();
			const timeTaken = endTime - startTime;

			if (timeTaken > 60000) {
				fail(`Opening large duplicated parquet took ${timeTaken} milliseconds (R)`);
			} else {
				logger.log(`Opening large duplicated parquet took ${timeTaken} milliseconds (R)`);
			}
		});
	}
});
