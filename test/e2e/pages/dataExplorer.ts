/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { Workbench } from '../infra/workbench';

const HEADER_TITLES = '.data-grid-column-header .title';
const DATA_GRID_ROWS = '.data-explorer-panel .right-column .data-grid-rows-container';
const DATA_GRID_ROW = '.data-grid-row';

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


export class DataExplorer {
	statusBar: Locator;
	private idleStatus: Locator;
	private _filters: Filters;
	private _editorActionBar: EditorActionBar;
	private _dataGrid: DataGrid;
	private _convertToCodeModal: ConvertToCodeModal;
	private _summaryPanel: SummaryPanel;

	constructor(private code: Code, private workbench: Workbench) {
		this._filters = new Filters(this.code);
		this._editorActionBar = new EditorActionBar(this.code, this.workbench);
		this._dataGrid = new DataGrid(this.code, this);
		this._convertToCodeModal = new ConvertToCodeModal(this.code, this.workbench);
		this._summaryPanel = new SummaryPanel(this.code, this.workbench);
		this.statusBar = this.code.driver.page.locator(STATUS_BAR);
		this.idleStatus = this.code.driver.page.locator('.status-bar-indicator .icon.idle');
	}

	// --- Actions ---

	async maximize(hideSummaryPanel: boolean = false): Promise<void> {
		await this.workbench.hotKeys.stackedLayout();
		await this.workbench.hotKeys.closeSecondarySidebar();
		await this.workbench.hotKeys.closePrimarySidebar();
		await this.workbench.hotKeys.toggleBottomPanel();

		if (hideSummaryPanel) {
			await this.summaryPanel.hide();
		}
	}

	// --- Verifications ---

	async waitForIdle(timeout = 60000): Promise<void> {
		await test.step('Wait for data grid to be idle', async () => {
			await expect(this.idleStatus).toBeVisible({ timeout });
		});
	}

	async expectStatusBarToHaveText(expectedText: string, timeout = 60000): Promise<void> {
		await test.step(`Expect status bar text: ${expectedText}`, async () => {
			await expect(this.code.driver.page.locator(STATUS_BAR)).toHaveText(expectedText, { timeout });
		});
	}

	get filters(): Filters {
		return this._filters;
	}

	get editorActionBar(): EditorActionBar {
		return this._editorActionBar;
	}

	get grid(): DataGrid {
		return this._dataGrid;
	}

	get convertToCodeModal(): ConvertToCodeModal {
		return this._convertToCodeModal;
	}

	get summaryPanel(): SummaryPanel {
		return this._summaryPanel;
	}
}

// -----------------------
//    Editor Action Bar
// -----------------------
export class EditorActionBar {

	constructor(private code: Code, private workbench: Workbench) { }

	// --- Actions ---

	async clickButton(buttonLabel: 'Convert to Code' | 'Clear Column Sorting' | 'Open as Plain Text File'): Promise<void> {
		await this.workbench.editorActionBar.clickButton(buttonLabel);
	}

	// --- Verifications ---
	async expectToHaveButton(buttonName: string, isVisible: boolean = true) {
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

}

// -------------------
//     Filters
// -------------------
export class Filters {
	private clearSortingButton: Locator;
	addFilterButton: Locator;
	private clearFilterButton: Locator;
	selectColumnButton: Locator;
	private selectConditionButton: Locator;
	private selectFilterModalValue: (value: string) => Locator;
	private applyFilterButton: Locator;
	// private filteringMenu: Locator;
	// private menuItemClearFilters: Locator;

	constructor(private code: Code) {
		this.clearSortingButton = this.code.driver.page.locator(CLEAR_SORTING_BUTTON);
		this.clearFilterButton = this.code.driver.page.locator(CLEAR_FILTER_BUTTON);
		this.addFilterButton = this.code.driver.page.getByRole('button', { name: 'Add Filter' });
		this.selectColumnButton = this.code.driver.page.getByRole('button', { name: 'Select Column' });
		this.selectConditionButton = this.code.driver.page.getByRole('button', { name: 'Select Condition' });
		this.selectFilterModalValue = (value: string) => this.code.driver.page.locator('.positron-modal-popup').getByRole('button', { name: value });
		this.applyFilterButton = this.code.driver.page.getByRole('button', { name: 'Apply Filter' });
		// this.filteringMenu = this.code.driver.page.getByRole('button', { name: 'Filtering' });
		// this.menuItemClearFilters = this.code.driver.page.getByRole('button', { name: 'Clear Filters' });
	}

	// --- Actions ---

	/*
	 * Add a filter to the data explorer.  Only works for a single filter at the moment.
	 */
	async add(columnName: string, condition: string, value?: string) {
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

	async clearAll() {
		if (await this.clearSortingButton.isVisible() && await this.clearSortingButton.isEnabled()) {
			await this.clearSortingButton.click();
		}
		if (await this.clearFilterButton.isVisible()) {
			await this.clearFilterButton.click();
		}
	}
}

// -------------------
//    Data Grid
// -------------------
export class DataGrid {
	grid: Locator;
	private statusBar: Locator;
	private columnHeaders = this.code.driver.page.locator(HEADER_TITLES);
	private rows = this.code.driver.page.locator(`${DATA_GRID_ROWS} ${DATA_GRID_ROW}`);
	cell = (rowIndex: number, columnIndex: number) => this.code.driver.page.locator(
		`${DATA_GRID_ROWS} ${DATA_GRID_ROW}:nth-child(${rowIndex + 1}) > div:nth-child(${columnIndex + 1})`
	);

	constructor(private code: Code, private dataExplorer: DataExplorer) {
		this.grid = this.code.driver.page.locator('.data-explorer .right-column');
		this.statusBar = this.code.driver.page.locator(STATUS_BAR);
	}

	// --- Actions ---

	async jumpToStart(): Promise<void> {
		if (process.platform === 'darwin') {
			await this.code.driver.page.keyboard.press('Meta+Home');
		} else {
			await this.code.driver.page.keyboard.press('Control+Home');
		}
	}

	async clickLowerRightCorner() {
		await this.code.driver.page.locator(SCROLLBAR_LOWER_RIGHT_CORNER).click();
	}

	async clickUpperLeftCorner() {
		await this.code.driver.page.locator(DATA_GRID_TOP_LEFT).click();
	}

	async sortColumnBy(columnIndex: number, sortBy: string) {
		await test.step(`Sort column ${columnIndex} by: ${sortBy}`, async () => {
			await this.code.driver.page.locator(`.data-grid-column-header:nth-child(${columnIndex}) .sort-button`).click();
			await this.code.driver.page.locator(`.positron-modal-overlay div.title:has-text('${sortBy}')`).click();
		});
	}

	/**
	 * Click a cell by its visual position (Index is 0-based)
	 * For example, if column 0 is a pin, clicking (0,0) will click the pinned column despite its index
	 */
	async clickCell(rowIndex: number, columnIndex: number, withShift = false) {
		await test.step(`Click cell by 0-based position: row ${rowIndex}, column ${columnIndex}`, async () => {
			await this.cell(rowIndex, columnIndex).click({ modifiers: withShift ? ['Shift'] : [] });
		});
	}

	/**
	 * Click a cell by its index (Index is 0-based, these never change even with sorting or filtering)
	 * If a column/row is pinned, this method finds the cell by its original row/col index values
	 */
	async clickCellByIndex(rowIndex: number, columnIndex: number, withShift = false) {
		await test.step(`Click cell by index: row ${rowIndex}, column ${columnIndex}`, async () => {
			const cell = this.grid.locator(`#data-grid-row-cell-content-${columnIndex}-${rowIndex}`);
			await cell.click({ modifiers: withShift ? ['Shift'] : [] });
		});
	}

	// --- Getters ---

	async getRowCount(): Promise<number> {
		const statusText = await this.statusBar.innerText();
		const match = statusText.match(/(\d+(?:,\d+)*)\s+rows?/);
		if (match && match[1]) {
			return parseInt(match[1].replace(/,/g, ''), 10);
		}
		return 0;
	}

	async getColumnCount(): Promise<number> {
		const statusText = await this.statusBar.innerText();
		const match = statusText.match(/(\d+(?:,\d+)*)\s+columns?/);
		if (match && match[1]) {
			return parseInt(match[1].replace(/,/g, ''), 10);
		}
		return 0;
	}

	async getData(): Promise<object[]> {

		await this.dataExplorer.waitForIdle();

		// need a brief additional wait
		await this.code.wait(1000);

		const allHeaders = await this.columnHeaders.all();
		const allRows = await this.rows.all();
		const headerNames = await Promise.all(allHeaders.map(async (header) => await header.textContent()));

		const tableData: object[] = [];
		for (const row of allRows) {
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

	async getColumnHeaders(): Promise<string[]> {
		const headersLocator = this.code.driver.page.locator('div.column-name');
		return await headersLocator.allInnerTexts();
	}

	// --- Verifications ---

	async verifyColumnHeaders(expectedHeaders: string[]) {
		await this.jumpToStart();
		await this.clickCell(0, 0)
		let maxScrollAttempts = await this.getColumnCount()
		for (let i = 0; i < expectedHeaders.length; i++) {
			const headerIsVisible = this.columnHeaders.getByText(expectedHeaders[i], { exact: true }).isVisible();
			if (await headerIsVisible) {
				await expect(this.columnHeaders.getByText(expectedHeaders[i], { exact: true })).toBeVisible();
				continue;
			}
			if (maxScrollAttempts > 0) {
				await this.code.driver.page.keyboard.press('ArrowRight');
				await this.code.driver.page.keyboard.press('ArrowRight');
				maxScrollAttempts = maxScrollAttempts - 2;
				i--;
			} else {
				throw new Error(`Could not find column header: ${expectedHeaders[i]}`);
			}
		}
	}

	async verifyTableDataLength(expectedLength: number) {
		await test.step('Verify data explorer table data length', async () => {
			await expect(async () => {
				const tableData = await this.getData();
				expect(tableData.length).toBe(expectedLength);
			}).toPass({ timeout: 60000 });
		});
	}

	async verifyTableDataRowValue(rowIndex: number, expectedData: CellData) {
		await test.step(`Verify data explorer row ${rowIndex} data`, async () => {
			await expect(async () => {
				const tableData = await this.getData();
				const rowData = tableData[rowIndex];

				for (const [key, value] of Object.entries(expectedData)) {
					expect(rowData[key]).toBe(value);
				}
			}).toPass({ timeout: 60000 });
		});
	}

	async expectLastCellContentToBe(columnName: string, expectedContent: string, rowAtIndex = -1): Promise<void> {
		await test.step(`Verify last cell content: ${expectedContent}`, async () => {
			await expect(async () => {
				const tableData = await this.getData();
				const lastRow = tableData.at(rowAtIndex);
				const lastHour = lastRow![columnName];
				expect(lastHour).toBe(expectedContent);
			}, 'Verify last hour cell content').toPass();
		});
	}

	async verifyTableData(expectedData: Array<{ [key: string]: string | number }>, timeout = 60000) {
		await test.step('Verify data explorer data', async () => {
			await expect(async () => {
				const tableData = await this.getData();
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

	// --- Utils ---

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
}

// ----------------------
//     Summary Panel
// ----------------------
export class SummaryPanel {
	private summaryPanel: Locator;
	private summaryFilterBar: Locator;
	private searchFilter: Locator;
	private sortFilter: Locator;
	private columnSummary: Locator;
	private columnSummaryName: Locator;
	private actionBar: Locator;
	private clearColumnSortingButton: Locator;
	private verticalScrollbar: Locator;

	constructor(private code: Code, private workbench: Workbench,) {
		this.summaryPanel = this.code.driver.page.locator('.data-explorer .left-column');
		this.summaryFilterBar = this.summaryPanel.locator('.summary-row-filter-bar');
		this.searchFilter = this.summaryFilterBar.getByRole('textbox', { name: 'filter' });
		this.sortFilter = this.summaryFilterBar.getByRole('button', { name: 'Sort summary row data' });
		this.columnSummary = this.summaryPanel.locator('.column-summary');
		this.columnSummaryName = this.columnSummary.locator('.column-name');
		this.actionBar = this.code.driver.page.locator('.editor-action-bar');
		this.clearColumnSortingButton = this.actionBar.getByRole('button', { name: 'Clear Column Sorting' });
		this.verticalScrollbar = this.summaryPanel.locator('div.data-grid-scrollbar-slider');
	}

	// --- Actions ---

	async hide(): Promise<void> {
		await this.workbench.hotKeys.hideDataExplorerSummaryPanel();
	}

	async show(): Promise<void> {
		await this.workbench.hotKeys.showDataExplorerSummaryPanel();
	}

	async search(filterText: string) {
		await test.step('Search summary panel', async () => {
			await this.searchFilter.fill(filterText);
			await this.searchFilter.press('Enter');
		});
	}

	async clearSearch() {
		await test.step('Clear search filter in summary panel', async () => {
			await this.searchFilter.fill('');
			await this.searchFilter.press('Enter');
		});
	}

	async sortBy(sortBy: ColumnSort) {
		await test.step('Sort summary panel', async () => {
			await this.workbench.contextMenu.triggerAndClick({
				menuTrigger: this.sortFilter,
				menuItemType: 'menuitemcheckbox',
				menuItemLabel: `Sort by ${sortBy}`
			});
		});
	}

	async clearSort() {
		await test.step('Clear sort in summary panel', async () => {
			await this.clearColumnSortingButton.click();
		});
	}

	async expandColumnProfile(rowNumber = 0): Promise<void> {
		await this.code.driver.page.locator(EXPAND_COLLASPE_ICON).nth(rowNumber).click();
	}

	// --- Getters ---

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
		// Find sparkline containers within the expanded profile area for this specific row
		const profileAreaSelector = `${DATA_GRID_ROW}:nth-child(${rowNumber}) .column-profile-sparkline`;
		const containers = await this.code.driver.page.locator(`${profileAreaSelector} foreignObject.tooltip-container`).all();
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

	// --- Verifications ---

	async expectSortToBeBy(sortBy: ColumnSort) {
		await test.step('Verify sort order in summary panel', async () => {
			await expect(this.sortFilter).toHaveText(`Sort by ${sortBy}`);
		});
	}

	async expectColumnCountToBe(count: number) {
		await test.step('Verify column count in summary panel', async () => {
			await expect(this.columnSummary).toHaveCount(count);
		});
	}

	async expectColumnNameToBe(columnProfileIndex: number, expectedName: string) {
		await test.step(`Verify column ${columnProfileIndex} name is "${expectedName}"`, async () => {
			const columnName = this.columnSummaryName.nth(columnProfileIndex);
			await expect(columnName).toHaveText(expectedName);
		});
	}

	async expectColumnOrderToBe(columnNames: string[]) {
		await test.step('Verify column order in summary panel', async () => {
			const actualOrder = await this.columnSummaryName.allInnerTexts();
			expect(actualOrder).toEqual(columnNames);
		});
	}

	async expectColumnToBe({ index, name, expanded }: { index: number; name: string; expanded: boolean }) {
		await test.step(`Expect col [${index}] to be: "${name}", ${expanded ? 'expanded' : 'collapsed'}`, async () => {
			expanded
				? await this.expectColumnProfileToBeExpanded(index)
				: await this.expectColumnProfileToBeCollapsed(index);

			await this.expectColumnNameToBe(index, name);
		});
	}

	async expectScrollbarToBeVisible(visible = true) {
		await test.step(`Verify vertical scrollbar: ${visible ? 'visible' : 'not visible'}`, async () => {
			visible
				? await expect(this.verticalScrollbar).toBeVisible({ timeout: 5000 })
				: await expect(this.verticalScrollbar).not.toBeVisible({ timeout: 5000 });
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

	async expectColumnProfileToBeExpanded(columnProfileIndex: number) {
		await this.expectColumnSummaryIndexExpansion(columnProfileIndex, 'expanded');
	}

	async expectColumnProfileToBeCollapsed(columnProfileIndex: number) {
		await this.expectColumnSummaryIndexExpansion(columnProfileIndex, 'collapsed');
	}

	private async expectColumnSummaryIndexExpansion(columnProfileIndex: number, expansion: 'expanded' | 'collapsed') {
		await test.step(`Verify column ${columnProfileIndex} is ${expansion}`, async () => {

			// Verify chevron direction
			const column = this.columnSummary.nth(columnProfileIndex);
			if (expansion === 'expanded') {
				await expect(column.locator('.codicon-chevron-down'), 'column should have down chevron').toBeVisible();
			} else {
				await expect(column.locator('.codicon-chevron-right'), 'column should have right chevron').toBeVisible();
			}

			// Verify expansion
			const box = await column.boundingBox();
			expect(box).not.toBeNull();

			if (expansion === 'expanded') {
				expect(box!.height, 'column should be expanded vertically').toBeGreaterThan(100);
			} else {
				expect(box!.height, 'column should be collapsed vertically').toBeLessThan(100);
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
			// Try the proper selector first, then fallback to direct vector components
			// This handles both expanded profiles (with .column-profile-sparkline wrapper)
			// and collapsed headers (direct vector components)
			const firstSparkline = this.code.driver.page.locator('.column-profile-sparkline foreignObject.tooltip-container, .vector-histogram foreignObject.tooltip-container, .vector-frequency-table foreignObject.tooltip-container').nth(0);
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
			// After streamlining, tooltip shows either "No missing values" or "X% of values are missing"
			await expect(hoverTooltip).toContainText(/No missing values|of values are missing/);
		});
	}

}

// -----------------------------
//    Convert to Code Modal
// -----------------------------
export class ConvertToCodeModal {
	codeBox: Locator;

	constructor(private code: Code, private workbench: Workbench) {
		this.codeBox = this.code.driver.page.locator('.positron-modal-dialog-box .convert-to-code-editor');
	}

	// --- Actions ---

	async clickOK() {
		await this.workbench.modals.clickButton('Copy Code');
	}

	async clickCancel() {
		await this.workbench.modals.clickButton('Cancel');
	}

	// --- Verifications ---

	async expectToBeVisible() {
		await test.step('Verify convert to code modal is visible', async () => {
			await expect(this.codeBox).toBeVisible();
			await this.workbench.modals.expectButtonToBeVisible('Copy Code');
			await this.workbench.modals.expectButtonToBeVisible('Cancel');
		});
	}

	async expectSyntaxHighlighting() {
		await test.step('Verify syntax highlighting', async () => {
			// Verify code highlighting - more than one style means highlighting is active
			const mtkLocator = this.code.driver.page.locator('[class*="mtk"]');
			const tokenClasses = await mtkLocator.evaluateAll(spans =>
				Array.from(new Set(
					spans.flatMap(span => Array.from(span.classList))
						.filter(cls => cls.startsWith('mtk'))
				))
			);
			expect(tokenClasses.length).toBeGreaterThan(1);

			// Verify bracket highlighting
			const bracketHighlightingCount = await this.code.driver.page.locator('[class*="bracket-highlighting-"]').count();
			expect(bracketHighlightingCount).toBeGreaterThan(0);
		});
	}
}

type ColumnSort = 'Original' | 'Name, Ascending' | 'Name, Descending' | 'Type, Ascending' | 'Type, Descending';

export interface CellData {
	[key: string]: string;
}

export interface ColumnProfile {
	profileData: { [key: string]: string };
	profileSparklineHeights: string[];
}

export type CellPosition = { row: number; col: number };
