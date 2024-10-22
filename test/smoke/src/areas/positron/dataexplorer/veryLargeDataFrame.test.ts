/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, downloadFileFromS3, PositronPythonFixtures, PositronRFixtures, S3FileDownloadOptions } from '../../../../../automation';
import { fail } from 'assert';
import { setupAndStartApp } from '../../../test-runner/test-hooks';
import { join } from 'path';

let logger;

// AWS Configuration
const region = "us-west-2";
const bucketName = "positron-qa-data-files";
const objectKey = "largeParquet.parquet";

const githubActions = process.env.GITHUB_ACTIONS === "true";

describe('Data Explorer - Very Large Data Frame #win', () => {
	logger = setupAndStartApp();

	before(async function () {

		if (githubActions) {

			const localFilePath = join(this.app.workspacePathOrFolder, "data-files", objectKey);

			const downloadOptions: S3FileDownloadOptions = {
				region: region,
				bucketName: bucketName,
				key: objectKey,
				localFilePath: localFilePath
			};
			await downloadFileFromS3(downloadOptions);
		}

	});


	describe('Python Data Explorer (Very Large Data Frame)', () => {

		before(async function () {

			await PositronPythonFixtures.SetupFixtures(this.app as Application);

		});

		afterEach(async function () {

			const app = this.app as Application;

			await app.workbench.positronDataExplorer.closeDataExplorer();
			await app.workbench.positronVariables.openVariables();

		});

		if (githubActions) {
			it('Python - Verifies data explorer functionality with very large unique data dataframe [C804823]', async function () {
				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'performance', 'loadBigParquet.py'));

				await app.workbench.quickaccess.runCommand('python.execInConsole');

				const startTime = performance.now();

				logger.log('Opening data grid');
				await expect(async () => {
					await app.workbench.positronVariables.doubleClickVariableRow('df');
					await app.code.driver.getLocator('.label-name:has-text("Data: df")').innerText();
				}).toPass();

				await app.workbench.positronSideBar.closeSecondarySideBar();

				// awaits table load completion
				await app.workbench.positronDataExplorer.getDataExplorerTableData();

				const endTime = performance.now();

				const timeTaken = endTime - startTime;

				if (timeTaken > 40000) {
					fail(`Opening large unique parquet took ${timeTaken} milliseconds (pandas)`);
				} else {
					logger.log(`Opening large unique parquet took ${timeTaken} milliseconds (pandas)`);
				}

			});
		} else {

			it('Python - Verifies data explorer functionality with very large duplicated data dataframe [C807824]', async function () {
				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'performance', 'multiplyParquet.py'));

				await app.workbench.quickaccess.runCommand('python.execInConsole');

				const startTime = performance.now();

				logger.log('Opening data grid');
				await expect(async () => {
					await app.workbench.positronVariables.doubleClickVariableRow('df_large');
					await app.code.driver.getLocator('.label-name:has-text("Data: df_large")').innerText();
				}).toPass();

				await app.workbench.positronSideBar.closeSecondarySideBar();

				// awaits table load completion
				await app.workbench.positronDataExplorer.getDataExplorerTableData();

				const endTime = performance.now();

				const timeTaken = endTime - startTime;

				if (timeTaken > 27000) {
					fail(`Opening large duplicated parquet took ${timeTaken} milliseconds (pandas)`);
				} else {
					logger.log(`Opening large duplicated parquet took ${timeTaken} milliseconds (pandas)`);
				}
			});
		}
	});

	describe('R Data Explorer (Very Large Data Frame)', () => {

		before(async function () {

			await PositronRFixtures.SetupFixtures(this.app as Application);

		});

		afterEach(async function () {

			const app = this.app as Application;

			await app.workbench.positronDataExplorer.closeDataExplorer();
			await app.workbench.positronVariables.openVariables();

		});

		if (githubActions) {
			it('R - Verifies data explorer functionality with very large unique data dataframe [C804824]', async function () {
				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'performance', 'loadBigParquet.r'));

				await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

				const startTime = performance.now();

				logger.log('Opening data grid');
				await expect(async () => {
					await app.workbench.positronVariables.doubleClickVariableRow('df2');
					await app.code.driver.getLocator('.label-name:has-text("Data: df2")').innerText();
				}).toPass();

				await app.workbench.positronSideBar.closeSecondarySideBar();

				// awaits table load completion
				await app.workbench.positronDataExplorer.getDataExplorerTableData();

				const endTime = performance.now();

				const timeTaken = endTime - startTime;

				if (timeTaken > 75000) {
					fail(`Opening large unique parquet took ${timeTaken} milliseconds (R)`);
				} else {
					logger.log(`Opening large unique parquet took ${timeTaken} milliseconds (R)`);
				}
			});
		} else {

			it('R - Verifies data explorer functionality with very large duplicated data dataframe [C807825]', async function () {
				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'performance', 'multiplyParquet.r'));

				await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

				const startTime = performance.now();

				logger.log('Opening data grid');
				await expect(async () => {
					await app.workbench.positronVariables.doubleClickVariableRow('df3_large');
					await app.code.driver.getLocator('.label-name:has-text("Data: df3_large")').innerText();
				}).toPass();

				await app.workbench.positronSideBar.closeSecondarySideBar();

				// awaits table load completion
				await app.workbench.positronDataExplorer.getDataExplorerTableData();

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
});
