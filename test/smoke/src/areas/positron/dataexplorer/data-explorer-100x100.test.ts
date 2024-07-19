/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { join } from 'path';
import { expect } from '@playwright/test';
import { installAllHandlers } from '../../../utils';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';

/**
 * Sets up the Data Explorer 100x100 smoke test.
 * @param logger The logger.
 */
export function setupDataExplorer100x100Test(logger: Logger) {
	/**
	 * Data Explorer 100x100.
	 */
	describe('Data Explorer 100x100', function () {
		// Shared before/after handling.
		installAllHandlers(logger);


		/**
		 * Tests the data explorer.
		 * @param app The application.
		 * @param language The language.
		 * @param prompt The prompt.
		 * @param commands Commands to run to set up the test.
		 * @param dataFrameName The data frame name.
		 * @param tsvFilePath The TSV file path.
		 */
		const testDataExplorer = async (
			app: Application,
			language: 'Python' | 'R',
			prompt: string,
			commands: string[],
			dataFrameName: string,
			tsvFilePath: string
		): Promise<void> => {
			// Execute commands.
			for (let i = 0; i < commands.length; i++) {
				await app.workbench.positronConsole.executeCode(
					language,
					commands[i],
					prompt
				);
			}

			// Open the data frame.
			await expect(async () => {
				await app.workbench.positronVariables.doubleClickVariableRow(dataFrameName);
				await app.code.driver.getLocator(`.label-name:has-text("Data: ${dataFrameName}")`).innerText();
			}).toPass();

			// Drive focus into the data explorer.
			await app.workbench.positronDataExplorer.clickUpperLeftCorner();

			// Load the TSV file that is used to verify the data and split it into lines.
			const tsvFile = fs.readFileSync(tsvFilePath, { encoding: 'utf8' });
			let lines: string[];
			if (process.platform === 'win32') {
				lines = tsvFile.split('\r\n');
			} else {
				lines = tsvFile.split('\n');
			}

			// Get the TSV values.
			const tsvValues: string[][] = [];
			for (let rowIndex = 0; rowIndex < lines.length; rowIndex++) {
				tsvValues.push(lines[rowIndex].split('\t'));
			}

			/**
			 * Tests the row at the specified row index.
			 * @param rowIndex The row index of the row under test.
			 */
			const testRow = async (rowIndex: number) => {
				// Scroll to home and put the cursor there.
				await app.workbench.positronDataExplorer.cmdCtrlHome();

				// Navigate to the row under test.
				for (let i = 0; i < rowIndex; i++) {
					await app.workbench.positronDataExplorer.arrowDown();
				}

				// Test each cell in the row under test.
				const row = tsvValues[rowIndex];
				for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
					// Get the cell.
					const cell = await app.code.waitForElement(`#data-grid-row-cell-content-${columnIndex}-${rowIndex} .text-container .text-value`);

					// Test the cell.
					expect(cell.textContent, `${rowIndex},${columnIndex}`).toStrictEqual(row[columnIndex]);

					// Move to the next cell.
					await app.workbench.positronDataExplorer.arrowRight();
				}
			};

			// Check the first row, the middle row, and the last row.
			await testRow(0);
			await testRow(Math.trunc(tsvValues.length / 2));
			await testRow(tsvValues.length - 1);
		};

		/**
		 * Constructs the Parquet file path.
		 * @param app The application.
		 * @returns The Parquet file path.
		 */
		const parquetFilePath = (app: Application) => {
			// Set the path to the Parquet file.
			let parquetFilePath = join(
				app.workspacePathOrFolder,
				'data-files',
				'100x100',
				'100x100.parquet'
			);

			// On Windows, double escape the path.
			if (process.platform === 'win32') {
				parquetFilePath = parquetFilePath.replaceAll('\\', '\\\\');
			}

			// Return the path to the Parquet file.
			return parquetFilePath;
		};

		/**
		 * Data Explorer 100x100 - Python - Pandas.
		 */
		describe('Data Explorer 100x100 - Python - Pandas', function () {
			/**
			 * Before hook.
			 */
			before(async function () {
				const app = this.app as Application;
				const pythonFixtures = new PositronPythonFixtures(app);
				await pythonFixtures.startPythonInterpreter();
			});

			/**
			 * After hook.
			 */
			after(async function () {
				const app = this.app as Application;
				await app.workbench.positronDataExplorer.closeDataExplorer();
			});

			/**
			 * Data Explorer 100x100 - Python - Pandas - Smoke Test.
			 */
			it('Data Explorer 100x100 - Python - Pandas - Smoke Test [C557563] #nightly', async function () {
				// Get the app.
				const app = this.app as Application;

				// Test the data explorer.
				const dataFrameName = 'pandas100x100';
				await testDataExplorer(
					app,
					'Python',
					'>>>',
					[
						'import pandas as pd',
						`${dataFrameName} = pd.read_parquet("${parquetFilePath(app)}")`,
					],
					dataFrameName,
					join(app.workspacePathOrFolder, 'data-files', '100x100', 'pandas-100x100.tsv')
				);
			});
		});

		/**
		 * Data Explorer 100x100 - Python - Polars.
		 */
		describe('Data Explorer 100x100 - Python - Polars', function () {
			/**
			 * Before hook.
			 */
			before(async function () {
				const app = this.app as Application;
				const pythonFixtures = new PositronPythonFixtures(app);
				await pythonFixtures.startPythonInterpreter();
			});

			/**
			 * After hook.
			 */
			after(async function () {
				const app = this.app as Application;
				await app.workbench.positronDataExplorer.closeDataExplorer();
			});

			/**
			 * Data Explorer 100x100 - Python - Polars - Smoke Test.
			 */
			it('Data Explorer 100x100 - Python - Polars - Smoke Test [C674520] #nightly', async function () {
				// Get the app.
				const app = this.app as Application;

				// Test the data explorer.
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
		});

		/**
		 * Data Explorer 100x100 - R.
		 */
		describe('Data Explorer 100x100 - R', function () {
			/**
			 * Before hook.
			 */
			before(async function () {
				const app = this.app as Application;
				const rFixtures = new PositronRFixtures(app);
				await rFixtures.startRInterpreter();
			});

			/**
			 * After hook.
			 */
			after(async function () {
				const app = this.app as Application;
				await app.workbench.positronDataExplorer.closeDataExplorer();
			});

			/**
			 * Data Explorer 100x100 - R - Smoke Test.
			 */
			it('Data Explorer 100x100 - R - Smoke Test [C674521] #nightly', async function () {
				// Get the app.
				const app = this.app as Application;

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
						process.platform === 'linux' ? 'r-100x100-linux.tsv' : 'r-100x100.tsv'
					)
				);
			});
		});
	});
}
