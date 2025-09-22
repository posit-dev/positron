/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import * as fs from 'fs';
import { expect } from '@playwright/test';
import { Application } from '../../../infra';

export const testDataExplorer = async (
	app: Application,
	language: 'Python' | 'R',
	commands: string[],
	dataFrameName: string,
	tsvFilePath: string
): Promise<void> => {
	// Execute commands.
	for (let i = 0; i < commands.length; i++) {
		await app.positron.console.executeCode(
			language,
			commands[i],
		);
	}

	// Open the data frame.
	await app.positron.variables.doubleClickVariableRow(dataFrameName);
	await app.positron.editors.verifyTab(dataFrameName, { isVisible: true });

	// Maximize the data explorer.
	await app.positron.dataExplorer.maximize();

	// Drive focus into the data explorer.
	await app.positron.dataExplorer.grid.clickUpperLeftCorner();

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
		const keyboard = app.code.driver.page.keyboard
		// Scroll to home and put the cursor there.
		await app.positron.dataExplorer.grid.jumpToStart();

		// Navigate to the row under test.
		for (let i = 0; i < rowIndex; i++) {
			await keyboard.press('ArrowDown')
		}

		// Test each cell in the row under test.
		const row = tsvValues[rowIndex];
		for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
			// Get the cell.
			const cellLocator = app.code.driver.page.locator(`#data-grid-row-cell-content-${columnIndex}-${rowIndex} .text-container .text-value`);
			await expect(cellLocator).toBeVisible();

			// Get the cell value and test value.
			const secsRemover = (value: string) => value.replace(/^(.*)( secs)$/, '$1');
			const cellValue = secsRemover((await cellLocator.textContent()) || '');
			const testValue = secsRemover(row[columnIndex]);

			// If the test value is a number, perform a numerical "close enough" comparison;
			// otherwise, perform a strict equal comparison.
			if (testValue.match(/^-?\d*\.?\d*$/)) {
				expect(
					Math.abs(Number.parseFloat(cellValue) - Number.parseFloat(testValue))
				).toBeLessThan(0.05);
			} else {
				expect(await cellLocator.textContent(), `${rowIndex},${columnIndex}`).toStrictEqual(row[columnIndex]);
			}

			// Move to the next cell.
			await keyboard.press('ArrowRight')
		}

	};

	// Check the first row, the middle row, and the last row.
	await testRow(0);
	await testRow(Math.trunc(tsvValues.length / 2));
	await testRow(tsvValues.length - 1);

	// Return to Stacked layout
	await app.positron.layouts.enterLayout('stacked');

	// Check that "open as plaintext" button is not available
	await expect(app.code.driver.page.getByLabel('Open as Plain Text File')).not.toBeVisible();
};

export const parquetFilePath = (app: Application) => {
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
