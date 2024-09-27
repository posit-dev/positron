/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { join } from 'path';
import { expect } from '@playwright/test';
import { installAllHandlers } from '../../../utils';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';

export function setupDataExplorer100x100Test(logger: Logger) {
	describe('Data Explorer - 100x100 Data Validation', function () {
		installAllHandlers(logger);

		describe('Python - Pandas', function () {
			before(async function () {
				await new PositronPythonFixtures(this.app as Application).startPythonInterpreter();
			});

			after(async function () {
				await (this.app as Application).workbench.positronDataExplorer.closeDataExplorer();
			});

			it('should load data into Pandas DataFrame and validate grid content [C557563]', async function () {
				const app = this.app as Application;
				const dataFrameName = 'pandas100x100';
				await testDataExplorer(
					app,
					'Python',
					'>>>',
					['import pandas as pd', `${dataFrameName} = pd.read_parquet("${parquetFilePath(app)}")`],
					dataFrameName,
					join(app.workspacePathOrFolder, 'data-files', '100x100', 'pandas-100x100.tsv')
				);
			});
		});

		describe('Python - Polars', function () {
			before(async function () {
				await new PositronPythonFixtures(this.app as Application).startPythonInterpreter();
			});

			after(async function () {
				await (this.app as Application).workbench.positronDataExplorer.closeDataExplorer();
			});

			it('should load 1data into Polars DataFrame and verify values [C674520]', async function () {
				const app = this.app as Application;
				const dataFrameName = 'polars100x100';
				await testDataExplorer(
					app,
					'Python',
					'>>>',
					['import polars', `${dataFrameName} = polars.read_parquet("${parquetFilePath(app)}")`],
					dataFrameName,
					join(app.workspacePathOrFolder, 'data-files', '100x100', 'polars-100x100.tsv')
				);
			});
		});

		describe('R', function () {
			before(async function () {
				await new PositronRFixtures(this.app as Application).startRInterpreter();
			});

			after(async function () {
				await (this.app as Application).workbench.positronDataExplorer.closeDataExplorer();
			});

			it('should load data into R DataFrame using Arrow and validate data [C674521]', async function () {

				const app = this.app as Application;
				const dataFrameName = 'r100x100';
				await testDataExplorer(
					app,
					'R',
					'>',
					['library(arrow)', `${dataFrameName} <- read_parquet("${parquetFilePath(app)}")`],
					dataFrameName,
					join(app.workspacePathOrFolder, 'data-files', '100x100', 'r-100x100.tsv')
				);
			});
		});
	});
}

const testDataExplorer = async (
	app: Application,
	language: 'Python' | 'R',
	prompt: string,
	commands: string[],
	dataFrameName: string,
	tsvFilePath: string
): Promise<void> => {
	for (const command of commands) {
		await app.workbench.positronConsole.executeCode(language, command, prompt);
	}

	await expect(async () => {
		await app.workbench.positronVariables.doubleClickVariableRow(dataFrameName);
		await app.code.driver.getLocator(`.label-name:has-text("Data: ${dataFrameName}")`).innerText();
	}).toPass();

	await app.workbench.positronDataExplorer.clickUpperLeftCorner();

	const tsvFile = fs.readFileSync(tsvFilePath, { encoding: 'utf8' });
	const lines = tsvFile.split(process.platform === 'win32' ? '\r\n' : '\n');
	const tsvValues = lines.map(line => line.split('\t'));

	const testRow = async (rowIndex: number) => {
		await app.workbench.positronDataExplorer.cmdCtrlHome();

		for (let i = 0; i < rowIndex; i++) {
			await app.workbench.positronDataExplorer.arrowDown();
		}

		for (let columnIndex = 0; columnIndex < tsvValues[rowIndex].length; columnIndex++) {
			const cell = await app.code.waitForElement(`#data-grid-row-cell-content-${columnIndex}-${rowIndex} .text-container .text-value`);
			const cellValue = cell.textContent.replace(/^(.*)( secs)$/, '$1');
			const testValue = tsvValues[rowIndex][columnIndex].replace(/^(.*)( secs)$/, '$1');

			if (testValue.match(/^-?\d*\.?\d*$/)) {
				expect(Math.abs(Number.parseFloat(cellValue) - Number.parseFloat(testValue))).toBeLessThan(0.05);
			} else {
				expect(cellValue).toStrictEqual(testValue);
			}

			await app.workbench.positronDataExplorer.arrowRight();
		}
	};

	await testRow(0);
	await testRow(Math.trunc(tsvValues.length / 2));
	await testRow(tsvValues.length - 1);
};

const parquetFilePath = (app: Application) => {
	const parquetFilePath = join(app.workspacePathOrFolder, 'data-files', '100x100', '100x100.parquet');
	return process.platform === 'win32' ? parquetFilePath.replaceAll('\\', '\\\\') : parquetFilePath;
};
