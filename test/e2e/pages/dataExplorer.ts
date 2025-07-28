/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { Workbench } from '../infra/workbench';

const COLUMN_HEADERS = '.data-explorer-panel .right-column .data-grid-column-headers';
const HEADER_TITLES = '.data-grid-column-header .title-description .title';
const DATA_GRID_ROWS = '.data-explorer-panel .right-column .data-grid-rows';
const DATA_GRID_ROW = '.data-grid-row';
const IDLE_STATUS = '.status-bar-indicator .icon.idle';
const SCROLLBAR_LOWER_RIGHT_CORNER = '.data-grid-scrollbar-corner';
const DATA_GRID_TOP_LEFT = '.data-grid-corner-top-left';
const STATUS_BAR = '.positron-data-explorer .status-bar';
const CLEAR_SORTING_BUTTON = '.codicon-positron-clear-sorting';
const CLEAR_FILTER_BUTTON = '.codicon-positron-clear-filter';
const MISSING_PERCENT = (rowNumber: number) => `${DATA_GRID_ROW}:nth-child(${rowNumber}) .column-null-percent .text-percent`;
const EXPAND_COLLAPSE_PROFILE = (rowNumber: number) => `${DATA_GRID_ROW}:nth-child(${rowNumber}) .expand-collapse-button`;
const EXPAND_COLLASPE_ICON = '.expand-collapse-icon';
const PROFILE_LABELS = (rowNumber: number) => `${DATA_GRID_ROW}:nth-child(${rowNumber}) .column-profile-info .label`;
const PROFILE_VALUES = (rowNumber: number) => `${DATA_GRID_ROW}:nth-child(${rowNumber}) .column-profile-info .value`;


export interface CellData {
	[key: string]: string;
}

export interface ColumnProfile {
	profileData: { [key: string]: string };
	profileSparklineHeights: string[];
}

/*
 *  Reuseable Positron data explorer functionality for tests to leverage.
 */
export class DataExplorer {

	clearSortingButton: Locator;
	addFilterButton: Locator;
	clearFilterButton: Locator;
	selectColumnButton: Locator;
	selectConditionButton: Locator;
	applyFilterButton: Locator;
	selectFilterModalValue: (value: string) => Locator;
	filteringMenu: Locator;
	menuItemClearFilters: Locator;

	constructor(private code: Code, private workbench: Workbench) {
		this.clearSortingButton = this.code.driver.page.locator(CLEAR_SORTING_BUTTON);
		this.clearFilterButton = this.code.driver.page.locator(CLEAR_FILTER_BUTTON);
		this.addFilterButton = this.code.driver.page.getByRole('button', { name: 'Add Filter' });
		this.selectColumnButton = this.code.driver.page.getByRole('button', { name: 'Select Column' });
		this.selectConditionButton = this.code.driver.page.getByRole('button', { name: 'Select Condition' });
		this.selectFilterModalValue = (value: string) => this.code.driver.page.locator('.positron-modal-popup').getByRole('button', { name: value });
		this.applyFilterButton = this.code.driver.page.getByRole('button', { name: 'Apply Filter' });
		this.filteringMenu = this.code.driver.page.getByRole('button', { name: 'Filtering' });
		this.menuItemClearFilters = this.code.driver.page.getByRole('button', { name: 'Clear Filters' });
	}

	async clearAllFilters() {
		if (await this.clearSortingButton.isVisible() && await this.clearSortingButton.isEnabled()) {
			await this.clearSortingButton.click();
		}
		if (await this.clearFilterButton.isVisible()) {
			await this.clearFilterButton.click();
		}
	}

	/*
	 * Get the currently visible data explorer table data
	 */
	async getDataExplorerTableData(): Promise<object[]> {

		await expect(this.code.driver.page.locator(IDLE_STATUS)).toBeVisible({ timeout: 60000 });

		// need a brief additional wait
		await this.code.wait(1000);

		const headers = await this.code.driver.page.locator(`${COLUMN_HEADERS} ${HEADER_TITLES}`).all();
		const rows = await this.code.driver.page.locator(`${DATA_GRID_ROWS} ${DATA_GRID_ROW}`).all();
		const headerNames = await Promise.all(headers.map(async (header) => await header.textContent()));

		const tableData: object[] = [];
		for (const row of rows) {
			const rowData: CellData = {};
			let columnIndex = 0;
			for (const cell of await row.locator('> *').all()) {
				const innerText = await cell.textContent();
				const headerName = headerNames[columnIndex];
				// workaround for extra offscreen cells
				if (!headerName) {
					continue;
				}
				rowData[headerName] = innerText ?? '';
				columnIndex++;
			}
			tableData.push(rowData);
		}

		return tableData;
	}

	async clickLowerRightCorner() {
		await this.code.driver.page.locator(SCROLLBAR_LOWER_RIGHT_CORNER).click();
	}

	async clickUpperLeftCorner() {
		await this.code.driver.page.locator(DATA_GRID_TOP_LEFT).click();
	}

	/*
	 * Add a filter to the data explorer.  Only works for a single filter at the moment.
	 */
	async addFilter(columnName: string, condition: string, value?: string) {
		await test.step(`Add filter: ${columnName} ${condition} ${value}`, async () => {
			await this.addFilterButton.click();

			// select column
			await this.selectColumnButton.click();
			await this.selectFilterModalValue(columnName).click();

			// select condition
			await this.selectConditionButton.click();
			await this.selectFilterModalValue(condition).click();

			// enter value
			if (value) {
				await this.code.driver.page.getByRole('textbox', { name: 'value' }).fill(value);
			}

			await this.applyFilterButton.click();
		});
	}

	async expectLastCellContentToBe(columnName: string, expectedContent: string, rowAtIndex = -1): Promise<void> {
		await test.step(`Verify last cell content: ${expectedContent}`, async () => {
			await expect(async () => {
				const tableData = await this.getDataExplorerTableData();
				const lastRow = tableData.at(rowAtIndex);
				const lastHour = lastRow![columnName];
				expect(lastHour).toBe(expectedContent);
			}, 'Verify last hour cell content').toPass();
		});
	}

	async expectStatusBarToHaveText(expectedText: string, timeout = 60000): Promise<void> {
		await test.step(`Expect status bar text: ${expectedText}`, async () => {
			await expect(this.code.driver.page.locator(STATUS_BAR)).toHaveText(expectedText, { timeout });
		});
	}


	async selectColumnMenuItem(columnIndex: number, menuItem: string) {
		await test.step(`Sort column ${columnIndex} by: ${menuItem}`, async () => {
			await this.code.driver.page.locator(`.data-grid-column-header:nth-child(${columnIndex}) .sort-button`).click();
			await this.code.driver.page.locator(`.positron-modal-overlay div.title:has-text('${menuItem}')`).click();
		});
	}

	async expectActionBarToHaveButton(buttonName: string, isVisible: boolean = true) {
		await test.step(`Expect action bar to have button: ${buttonName}`, async () => {
			const button = this.code.driver.page.getByRole('button', { name: buttonName });
			if (isVisible) {
				await expect(button).toBeVisible();
			} else {
				await expect(button).not.toBeVisible();
			}
		});
	}

	async verifyCanOpenAsPlaintext(searchString: string | RegExp) {
		await this.workbench.editorActionBar.clickButton('Open as Plain Text File');

		// Check if the 'Open Anyway' button is visible. This is needed on web only as it warns
		// that the file is large and may take a while to open. This is due to a vs code behavior and file size limit.
		const openAnyway = this.code.driver.page.getByText('Open Anyway');

		if (await openAnyway.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
			await openAnyway.click();
		}

		await expect(this.code.driver.page.getByText(searchString, { exact: true })).toBeVisible();
	}

	async home(): Promise<void> {
		await this.code.driver.page.keyboard.press('Home');
	}

	async cmdCtrlHome(): Promise<void> {
		if (process.platform === 'darwin') {
			await this.code.driver.page.keyboard.press('Meta+Home');
		} else {
			await this.code.driver.page.keyboard.press('Control+Home');
		}
	}

	async arrowDown(): Promise<void> {
		await this.code.driver.page.keyboard.press('ArrowDown');
	}

	async arrowRight(): Promise<void> {
		await this.code.driver.page.keyboard.press('ArrowRight');
	}

	async arrowUp(): Promise<void> {
		await this.code.driver.page.keyboard.press('ArrowUp');
	}

	async arrowLeft(): Promise<void> {
		await this.code.driver.page.keyboard.press('ArrowLeft');
	}

	async getColumnMissingPercent(rowNumber: number): Promise<string> {
		const row = this.code.driver.page.locator(MISSING_PERCENT(rowNumber));
		return await row.innerText();
	}

	async getColumnProfileInfo(rowNumber: number): Promise<ColumnProfile> {

		const expandCollapseLocator = this.code.driver.page.locator(EXPAND_COLLAPSE_PROFILE(rowNumber));
		await expandCollapseLocator.scrollIntoViewIfNeeded();
		await expandCollapseLocator.click();
		await expect(expandCollapseLocator.locator(EXPAND_COLLASPE_ICON)).toHaveClass(/codicon-chevron-down/);

		const profileData: { [key: string]: string } = {};

		const labelsLocator = this.code.driver.page.locator(PROFILE_LABELS(rowNumber));
		await expect.poll(async () => (await labelsLocator.all()).length).toBeGreaterThan(2);
		const labels = await labelsLocator.all();

		const valuesLocator = this.code.driver.page.locator(PROFILE_VALUES(rowNumber));
		await expect.poll(async () => (await valuesLocator.all()).length).toBeGreaterThan(2);
		const values = await valuesLocator.all();

		for (let i = 0; i < labels.length; i++) {
			const label = await labels[i].textContent();
			const value = await values[i].textContent();
			if (label && value) {
				profileData[label] = value; // Assign label as key and value as value
			}
		}

		// Extract heights from tooltip containers which now have data-height attributes
		const containers = await this.code.driver.page.locator('.column-profile-sparkline svg foreignObject.tooltip-container').all();
		const profileSparklineHeights: string[] = [];
		for (let i = 0; i < containers.length; i++) {
			const height = await containers[i].getAttribute('data-height');
			if (height !== null) {
				const rounded = parseFloat(height).toFixed(1); // Round to one decimal place
				profileSparklineHeights.push(rounded);
			}
		}

		await expandCollapseLocator.scrollIntoViewIfNeeded();
		await expandCollapseLocator.click();

		await expect(expandCollapseLocator.locator(EXPAND_COLLASPE_ICON)).toHaveClass(/codicon-chevron-right/);

		const profileInfo: ColumnProfile = {
			profileData: profileData,
			profileSparklineHeights: profileSparklineHeights
		};

		return profileInfo;

	}

	async expandColumnProfile(rowNumber = 0): Promise<void> {
		await this.code.driver.page.locator(EXPAND_COLLASPE_ICON).nth(rowNumber).click();
	}

	async maximizeDataExplorer(collapseSummary: boolean = false): Promise<void> {
		await this.workbench.layouts.enterLayout('stacked');
		await this.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
		await this.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await this.workbench.quickaccess.runCommand('workbench.action.togglePanel');

		if (collapseSummary) {
			await this.collapseSummary();
		}
	}

	async collapseSummary(): Promise<void> {
		await this.workbench.quickaccess.runCommand('workbench.action.positronDataExplorer.collapseSummary');
	}

	async expandSummary(): Promise<void> {
		await test.step('Expand data explorer summary', async () => {
			await this.workbench.quickaccess.runCommand('workbench.action.positronDataExplorer.expandSummary');
		});
	}

	async verifyTableData(expectedData: Array<{ [key: string]: string | number }>, timeout = 60000) {
		await test.step('Verify data explorer data', async () => {
			await expect(async () => {
				const tableData = await this.getDataExplorerTableData();
				expect(tableData.length).toBe(expectedData.length);

				for (let i = 0; i < expectedData.length; i++) {
					const row = expectedData[i];
					for (const [key, expectedValue] of Object.entries(row)) {
						const actualValue = tableData[i][key];
						expect(this.normalize(actualValue)).toBe(this.normalize(expectedValue));
					}
				}
			}).toPass({ timeout });
		});
	}

	private normalize(value: unknown): string {
		const str = String(value).trim().toUpperCase();

		// Handle true missing values only
		if (value === null || value === undefined || ['NA', 'NAN', 'NULL'].includes(str)) {
			return '__MISSING__';
		}

		// If value is numeric (e.g., '25.0'), normalize precision
		const num = Number(value);
		if (!isNaN(num)) {
			return String(num);
		}

		return String(value).trim();
	}

	async verifyTableDataLength(expectedLength: number) {
		await test.step('Verify data explorer table data length', async () => {
			await expect(async () => {
				const tableData = await this.getDataExplorerTableData();
				expect(tableData.length).toBe(expectedLength);
			}).toPass({ timeout: 60000 });
		});
	}

	async verifyTableDataRowValue(rowIndex: number, expectedData: CellData) {
		await test.step(`Verify data explorer row ${rowIndex} data`, async () => {
			await expect(async () => {
				const tableData = await this.getDataExplorerTableData();
				const rowData = tableData[rowIndex];

				for (const [key, value] of Object.entries(expectedData)) {
					expect(rowData[key]).toBe(value);
				}
			}).toPass({ timeout: 60000 });
		});
	}

	async verifyMissingPercent(expectedValues: Array<{ column: number; expected: string }>) {
		await test.step('Verify missing percent values', async () => {
			for (const { column, expected } of expectedValues) {
				const missingPercent = await this.getColumnMissingPercent(column);
				expect(missingPercent).toBe(expected);
			}
		});
	}

	async verifyColumnData(expectedValues: Array<{ column: number; expected: { [key: string]: string } }>) {
		await test.step('Verify column data', async () => {
			for (const { column, expected } of expectedValues) {
				const profileInfo = await this.getColumnProfileInfo(column);
				expect(profileInfo.profileData).toStrictEqual(expected);
			}
		});
	}

	async verifySparklineHoverDialog(verificationText: string[]): Promise<void> {
		await test.step(`Verify sparkline tooltip: ${verificationText}`, async () => {
			const firstSparkline = this.code.driver.page.locator('.column-profile-sparkline svg foreignObject.tooltip-container').nth(0);
			await firstSparkline.hover();
			const hoverTooltip = this.code.driver.page.locator('.hover-contents');
			await expect(hoverTooltip).toBeVisible();

			for (const text of verificationText) {
				await expect(hoverTooltip).toContainText(text);
			}
		});
	}

	async verifySparklineHeights(expectedHeights: Array<{ column: number; expected: string[] }>) {
		await test.step('Verify sparkline heights', async () => {
			for (const { column, expected } of expectedHeights) {
				const colProfileInfo = await this.getColumnProfileInfo(column);
				expect(colProfileInfo.profileSparklineHeights).toStrictEqual(expected);
			}
		});
	}

	async verifyNullPercentHoverDialog(): Promise<void> {
		await test.step('Verify null percent hover dialog', async () => {
			const firstNullPercent = this.code.driver.page.locator('.column-null-percent').nth(0);
			await firstNullPercent.hover();
			const hoverTooltip = this.code.driver.page.locator('.hover-contents');
			await expect(hoverTooltip).toBeVisible();
			await expect(hoverTooltip).toContainText('Missing Values');
		});
	}

	// Note that herein we're getting the column headers from the filter popup, hence why new function and const.
	async getColumnHeaders(): Promise<string[]> {
		const headersLocator = this.code.driver.page.locator('div.column-name');
		return await headersLocator.allInnerTexts();
	}

	async verifyColumnHeaders(expectedHeaders: string[]) {
		await test.step('Verify column headers', async () => {
			const actualHeaders = await this.getColumnHeaders();
			const missing = expectedHeaders.filter(item => !actualHeaders.includes(item));
			expect(missing).toEqual([]); // Will throw if any are missing
		});
	}

	async clickCell(rowIndex: number, columnIndex: number) {
		await test.step(`Click cell at row ${rowIndex}, column ${columnIndex}`, async () => {
			const cellLocator = this.code.driver.page.locator(`${DATA_GRID_ROWS} ${DATA_GRID_ROW}:nth-child(${rowIndex + 1}) > div:nth-child(${columnIndex + 1})`);
			await cellLocator.click();
		});
	}

	async clickConvertToCodeButton() {
		await this.workbench.editorActionBar.clickButton('Convert to Code');
	}
}
