/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { join } from 'path';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { createWriteStream } from "fs";
import { pipeline } from "stream";
import { promisify } from "util";

/*
 * Data explorer test suite for large data frames
 */
export function setup(logger: Logger) {

	describe('Data Explorer - Very Large Data Frame', () => {

		// Shared before/after handling
		installAllHandlers(logger);

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

				console.log(`Opening large parquet took ${endTime - startTime} milliseconds`);

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


				//debug
				process.env.AWS_PROFILE = 'my-dev-profile';

				// Configuration
				const region = "us-west-2";
				const bucketName = "positron-qa-data-files";
				const objectKey = "largeParquet.parquet";
				const localFilePath = join(app.workspacePathOrFolder, "data-files", "largeParquet.parquet");

				// Create an S3 client and specify the SSO profile via environment variables
				const s3 = new S3Client({
					region
				});

				// Create the S3 GetObject command
				const command = new GetObjectCommand({
					Bucket: bucketName,
					Key: objectKey,
				});

				// Execute the command and handle the response
				let response;
				try {
					response = await s3.send(command);
				} catch (error) {
					console.error("Error:", (error as any).message, (error as any).stack);
				}

				// Check if the Body is a stream (for large files)
				if (!response.Body || !("pipe" in response.Body)) {
					throw new Error("Unexpected response from S3: Body is not a stream");
				}

				// Create a write stream to the local file
				const fileStream = createWriteStream(localFilePath);

				// Use pipeline to pipe the response stream to the file stream
				const streamPipeline = promisify(pipeline);
				await streamPipeline(response.Body, fileStream);
				console.log("File downloaded successfully!");

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

				console.log(`Opening large parquet took ${endTime - startTime} milliseconds`);
			});
		});


	});
}
