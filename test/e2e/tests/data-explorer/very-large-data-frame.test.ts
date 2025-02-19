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
		if (githubActions) {
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

	test.afterEach(async function ({ app }) {
		await app.workbench.dataExplorer.closeDataExplorer();
		await app.workbench.variables.togglePane('show');
	});

	if (githubActions) {

		test('Python - Verify data loads with very large unique data dataframe', async function ({ app, logger, python }) {
			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'performance', 'loadBigParquet.py'));
			await app.workbench.quickaccess.runCommand('python.execInConsole');
			const startTime = performance.now();

			await app.workbench.variables.doubleClickVariableRow('df');
			await app.workbench.dataExplorer.verifyTab('Data: df', { isVisible: true, isSelected: true });
			await app.workbench.sideBar.closeSecondarySideBar();

			// awaits table load completion
			await app.workbench.dataExplorer.getDataExplorerTableData();
			const endTime = performance.now();
			const timeTaken = endTime - startTime;

			if (timeTaken > 40000) {
				fail(`Opening large unique parquet took ${timeTaken} milliseconds (pandas)`);
			} else {
				logger.log(`Opening large unique parquet took ${timeTaken} milliseconds (pandas)`);
			}
		});

		test('R - Verify data loads with very large unique data dataframe', async function ({ app, logger, r }) {
			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'performance', 'loadBigParquet.r'));
			await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');
			const startTime = performance.now();

			await app.workbench.variables.doubleClickVariableRow('df2');
			await app.workbench.dataExplorer.verifyTab('Data: df2', { isVisible: true, isSelected: true });
			await app.workbench.sideBar.closeSecondarySideBar();

			// awaits table load completion
			await app.workbench.dataExplorer.getDataExplorerTableData();
			const endTime = performance.now();
			const timeTaken = endTime - startTime;

			if (timeTaken > 75000) {
				fail(`Opening large unique parquet took ${timeTaken} milliseconds (R)`);
			} else {
				logger.log(`Opening large unique parquet took ${timeTaken} milliseconds (R)`);
			}
		});

	} else {

		test('Python - Verify data loads with very large duplicated data dataframe', async function ({ app, logger, python }) {
			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'performance', 'multiplyParquet.py'));
			await app.workbench.quickaccess.runCommand('python.execInConsole');
			const startTime = performance.now();

			await app.workbench.variables.doubleClickVariableRow('df_large');
			await app.workbench.dataExplorer.verifyTab('Data: df_large', { isVisible: true, isSelected: true });
			await app.workbench.sideBar.closeSecondarySideBar();

			// awaits table load completion
			await app.workbench.dataExplorer.getDataExplorerTableData();
			const endTime = performance.now();
			const timeTaken = endTime - startTime;

			if (timeTaken > 27000) {
				fail(`Opening large duplicated parquet took ${timeTaken} milliseconds (pandas)`);
			} else {
				logger.log(`Opening large duplicated parquet took ${timeTaken} milliseconds (pandas)`);
			}
		});

		test('R - Verify data loads with very large duplicated data dataframe', async function ({ app, logger, r }) {
			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'performance', 'multiplyParquet.r'));
			await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');
			const startTime = performance.now();

			await app.workbench.variables.doubleClickVariableRow('df3_large');
			await app.workbench.dataExplorer.verifyTab('Data: df3_large', { isVisible: true, isSelected: true });
			await app.workbench.sideBar.closeSecondarySideBar();

			// awaits table load completion
			await app.workbench.dataExplorer.getDataExplorerTableData();
			const endTime = performance.now();
			const timeTaken = endTime - startTime;

			if (timeTaken > 60000) {
				fail(`Opening large dupliacted parquet took ${timeTaken} milliseconds (R)`);
			} else {
				logger.log(`Opening large duplicated parquet took ${timeTaken} milliseconds (R)`);
			}
		});
	}
});
