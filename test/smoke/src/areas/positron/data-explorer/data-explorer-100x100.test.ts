/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { test, expect } from '../_test.setup';
import { join } from 'path';
import { Application } from '../../../../../automation';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer 100x100', {
	tag: ['@win']
}, function () {
	test.afterEach(async function ({ app }) {
		await app.workbench.positronDataExplorer.closeDataExplorer();
	});

	test('Data Explorer 100x100 - Python - Pandas [C557563]', async function ({ app, interpreter }) {
		test.setTimeout(180000);
		await interpreter.set('Python');

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

	test('Data Explorer 100x100 - Python - Polars [C674520]', async function ({ app, interpreter }) {
		test.setTimeout(180000);
		await interpreter.set('Python');

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

	test('Data Explorer 100x100 - R [C674521]', async function ({ app, interpreter }) {
		test.setTimeout(180000);
		await interpreter.set('R');

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
				'r-100x100.tsv'
			)
		);
	});
});

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

	// Maximize the data explorer.
	await app.workbench.positronDataExplorer.maximizeDataExplorer();

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

			// Get the cell value and test value.
			const secsRemover = (value: string) => value.replace(/^(.*)( secs)$/, '$1');
			const cellValue = secsRemover(cell.textContent);
			const testValue = secsRemover(row[columnIndex]);

			// If the test value is a number, perform a numerical "close enough" comparison;
			// otherwise, perform a strict equal comparison.
			if (testValue.match(/^-?\d*\.?\d*$/)) {
				expect(
					Math.abs(Number.parseFloat(cellValue) - Number.parseFloat(testValue))
				).toBeLessThan(0.05);
			} else {
				expect(cell.textContent, `${rowIndex},${columnIndex}`).toStrictEqual(row[columnIndex]);
			}

			// Move to the next cell.
			await app.workbench.positronDataExplorer.arrowRight();
		}

	};

	// Check the first row, the middle row, and the last row.
	await testRow(0);
	await testRow(Math.trunc(tsvValues.length / 2));
	await testRow(tsvValues.length - 1);

	// Return to Stacked layout
	await app.workbench.positronLayouts.enterLayout('stacked');
};

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
