/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, downloadFileFromS3, Logger, PositronPythonFixtures, PositronRFixtures, S3FileDownloadOptions } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { join } from 'path';
import { fail } from 'assert';

/*
 * Data explorer test suite for large data frames
 */
export function setup(logger: Logger) {

	// AWS Configuration
	const region = "us-west-2";
	const bucketName = "positron-qa-data-files";
	const objectKey = "largeParquet.parquet";

	describe('Data Explorer - Very Large Data Frame', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		before(async function () {

			const localFilePath = join(this.app.workspacePathOrFolder, "data-files", objectKey);

			const downloadOptions: S3FileDownloadOptions = {
				region: region,
				bucketName: bucketName,
				key: objectKey,
				localFilePath: localFilePath
			};
			await downloadFileFromS3(downloadOptions);

		});


		describe('Python Data Explorer (Very Large Data Frame)', () => {

			before(async function () {

				await PositronPythonFixtures.SetupFixtures(this.app as Application);

			});

			after(async function () {

				const app = this.app as Application;

				await app.workbench.positronDataExplorer.closeDataExplorer();
				await app.workbench.positronVariables.openVariables();

			});

			it('Python - Verifies data explorer functionality with very large data frame [C...] #pr', async function () {
				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'performance', 'loadBigParquet.py'));

				const startTime = performance.now();

				await app.workbench.quickaccess.runCommand('python.execInConsole');

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

				if (timeTaken > 7500) {
					fail(`Opening large parquet took ${timeTaken} milliseconds (pandas)`);
				} else {
					logger.log(`Opening large parquet took ${timeTaken} milliseconds (pandas)`);
				}

			});
		});

		describe('R Data Explorer (Very Large Data Frame)', () => {

			before(async function () {

				await PositronRFixtures.SetupFixtures(this.app as Application);

			});

			after(async function () {

				const app = this.app as Application;

				await app.workbench.positronDataExplorer.closeDataExplorer();
				await app.workbench.positronVariables.openVariables();

			});

			it('R - Verifies data explorer functionality with very large data frame [C...] #pr', async function () {
				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'performance', 'loadBigParquet.r'));

				const startTime = performance.now();

				await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

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

				if (timeTaken > 15000) {
					fail(`Opening large parquet took ${timeTaken} milliseconds (R)`);
				} else {
					logger.log(`Opening large parquet took ${timeTaken} milliseconds (R)`);
				}
			});
		});


	});
}
