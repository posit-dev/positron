"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConvertToCodeModal = exports.SummaryPanel = exports.DataGrid = exports.Filters = exports.EditorActionBar = exports.DataExplorer = void 0;
const test_1 = __importStar(require("@playwright/test"));
const HEADER_TITLES = '.data-grid-column-header .title';
const DATA_GRID_ROWS = '.data-explorer-panel .right-column .data-grid-rows-container';
const DATA_GRID_ROW = '.data-grid-row';
const SCROLLBAR_LOWER_RIGHT_CORNER = '.data-grid-scrollbar-corner';
const DATA_GRID_TOP_LEFT = '.data-grid-corner-top-left';
const STATUS_BAR = '.positron-data-explorer .status-bar';
const CLEAR_SORTING_BUTTON = '.codicon-positron-clear-sorting';
const CLEAR_FILTER_BUTTON = '.codicon-positron-clear-filter';
const MISSING_PERCENT = (rowNumber) => `${DATA_GRID_ROW}:nth-child(${rowNumber}) .column-null-percent .text-percent`;
const EXPAND_COLLAPSE_PROFILE = (rowNumber) => `${DATA_GRID_ROW}:nth-child(${rowNumber}) .expand-collapse-button`;
const EXPAND_COLLASPE_ICON = '.expand-collapse-icon';
const PROFILE_LABELS = (rowNumber) => `${DATA_GRID_ROW}:nth-child(${rowNumber}) .column-profile-info .label`;
const PROFILE_VALUES = (rowNumber) => `${DATA_GRID_ROW}:nth-child(${rowNumber}) .column-profile-info .value`;
class DataExplorer {
    code;
    workbench;
    statusBar;
    idleStatus;
    _filters;
    _editorActionBar;
    _dataGrid;
    _convertToCodeModal;
    _summaryPanel;
    constructor(code, workbench) {
        this.code = code;
        this.workbench = workbench;
        this._filters = new Filters(this.code, this.workbench);
        this._editorActionBar = new EditorActionBar(this.code, this.workbench);
        this._dataGrid = new DataGrid(this.code, this);
        this._convertToCodeModal = new ConvertToCodeModal(this.code, this.workbench);
        this._summaryPanel = new SummaryPanel(this.code, this.workbench);
        this.statusBar = this.code.driver.currentPage.locator(STATUS_BAR);
        this.idleStatus = this.code.driver.currentPage.locator('.status-bar-indicator .icon.idle');
    }
    // --- Actions ---
    async maximize(showSummaryPanel = true) {
        await this.workbench.hotKeys.stackedLayout();
        await this.workbench.hotKeys.closeSecondarySidebar();
        await this.workbench.hotKeys.closePrimarySidebar();
        await this.workbench.hotKeys.toggleBottomPanel();
        showSummaryPanel
            ? await this.summaryPanel.show()
            : await this.summaryPanel.hide();
    }
    // --- Verifications ---
    async waitForIdle(timeout = 60000) {
        await test_1.default.step('Wait for data grid to be idle', async () => {
            await (0, test_1.expect)(this.idleStatus).toBeVisible({ timeout });
        });
    }
    async expectStatusBarToHaveText(expectedText, timeout = 15000) {
        await test_1.default.step(`Expect status bar text: ${expectedText}`, async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator(STATUS_BAR)).toHaveText(expectedText, { timeout });
        });
    }
    get filters() {
        return this._filters;
    }
    get editorActionBar() {
        return this._editorActionBar;
    }
    get grid() {
        return this._dataGrid;
    }
    get convertToCodeModal() {
        return this._convertToCodeModal;
    }
    get summaryPanel() {
        return this._summaryPanel;
    }
}
exports.DataExplorer = DataExplorer;
// -----------------------
//    Editor Action Bar
// -----------------------
class EditorActionBar {
    code;
    workbench;
    constructor(code, workbench) {
        this.code = code;
        this.workbench = workbench;
    }
    // --- Actions ---
    async clickButton(buttonLabel) {
        await this.workbench.editorActionBar.clickButton(buttonLabel);
    }
    // --- Verifications ---
    async expectToHaveButton(buttonName, isVisible = true) {
        await test_1.default.step(`Expect action bar to have button: ${buttonName}`, async () => {
            const button = this.code.driver.currentPage.getByRole('button', { name: buttonName });
            if (isVisible) {
                await (0, test_1.expect)(button).toBeVisible();
            }
            else {
                await (0, test_1.expect)(button).not.toBeVisible();
            }
        });
    }
    async verifyCanOpenAsPlaintext(searchString) {
        await this.workbench.editorActionBar.clickButton('Open as Plain Text File');
        // Check if the 'Open Anyway' button is visible. This is needed on web only as it warns
        // that the file is large and may take a while to open. This is due to a vs code behavior and file size limit.
        const openAnyway = this.code.driver.currentPage.getByText('Open Anyway');
        if (await openAnyway.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
            await openAnyway.click();
        }
        await (0, test_1.expect)(this.code.driver.currentPage.getByText(searchString, { exact: true })).toBeVisible();
    }
}
exports.EditorActionBar = EditorActionBar;
// -------------------
//     Filters
// -------------------
class Filters {
    code;
    workbench;
    clearSortingButton;
    addFilterButton;
    clearFilterButton;
    selectColumnButton;
    selectConditionButton;
    selectFilterModalValue;
    applyFilterButton;
    // private filteringMenu: Locator;
    // private menuItemClearFilters: Locator;
    constructor(code, workbench) {
        this.code = code;
        this.workbench = workbench;
        this.clearSortingButton = this.code.driver.currentPage.locator(CLEAR_SORTING_BUTTON);
        this.clearFilterButton = this.code.driver.currentPage.locator(CLEAR_FILTER_BUTTON);
        this.addFilterButton = this.code.driver.currentPage.getByRole('button', { name: 'Add Filter' });
        this.selectColumnButton = this.code.driver.currentPage.getByRole('button', { name: 'Select Column' });
        this.selectConditionButton = this.code.driver.currentPage.getByRole('button', { name: 'Select Condition' });
        this.selectFilterModalValue = (value) => this.code.driver.currentPage.locator('.positron-modal-popup').getByRole('button', { name: value });
        this.applyFilterButton = this.code.driver.currentPage.getByRole('button', { name: 'Apply Filter' });
        // this.filteringMenu = this.code.driver.currentPage.getByRole('button', { name: 'Filtering' });
        // this.menuItemClearFilters = this.code.driver.currentPage.getByRole('button', { name: 'Clear Filters' });
    }
    // --- Actions ---
    /**
     * Add a filter to the data explorer. Only works for a single filter at the moment. Optionally record metric.
     * @param options Object containing filter parameters
     */
    async add(options) {
        const { columnName, condition, value, metricRecord, metricTargetType } = options;
        await test_1.default.step(`Add filter: ${columnName} ${condition} ${value}`, async () => {
            await this.addFilterButton.click();
            // select column
            await this.selectColumnButton.click();
            await this.selectFilterModalValue(columnName).click();
            // select condition
            await this.selectConditionButton.click();
            await this.selectFilterModalValue(condition).click();
            // enter value
            if (value) {
                await this.code.driver.currentPage.getByRole('textbox', { name: 'value' }).fill(value);
            }
            // record metric only for loading after apply
            if (metricRecord && metricTargetType) {
                await metricRecord.dataExplorer.filter(async () => {
                    await this.applyFilterButton.click();
                    await this.workbench.dataExplorer.waitForIdle();
                }, metricTargetType);
            }
            else {
                await this.applyFilterButton.click();
            }
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
exports.Filters = Filters;
// -------------------
//    Data Grid
// -------------------
class DataGrid {
    code;
    dataExplorer;
    grid;
    statusBar;
    get rowHeader() { return this.code.driver.currentPage.locator('.data-grid-row-header'); }
    get columnHeaders() { return this.code.driver.currentPage.locator(HEADER_TITLES); }
    get rows() { return this.code.driver.currentPage.locator(`${DATA_GRID_ROWS} ${DATA_GRID_ROW}`); }
    cellByPosition = (rowIndex, columnIndex) => this.code.driver.currentPage.locator(`${DATA_GRID_ROWS} ${DATA_GRID_ROW}:nth-child(${rowIndex + 1}) > div:nth-child(${columnIndex + 1})`);
    cellByIndex = (rowIndex, columnIndex) => this.grid.locator(`#data-grid-row-cell-content-${columnIndex}-${rowIndex}`);
    constructor(code, dataExplorer) {
        this.code = code;
        this.dataExplorer = dataExplorer;
        this.grid = this.code.driver.currentPage.locator('.data-explorer .right-column');
        this.statusBar = this.code.driver.currentPage.locator(STATUS_BAR);
    }
    // --- Actions ---
    async jumpToStart() {
        if (process.platform === 'darwin') {
            await this.code.driver.currentPage.keyboard.press('Meta+Home');
        }
        else {
            await this.code.driver.currentPage.keyboard.press('Control+Home');
        }
    }
    async clickLowerRightCorner() {
        await this.code.driver.currentPage.locator(SCROLLBAR_LOWER_RIGHT_CORNER).click();
    }
    async clickUpperLeftCorner() {
        await this.code.driver.currentPage.locator(DATA_GRID_TOP_LEFT).click();
    }
    /**
     * Sort the specified column by the given sort option.
     * @param columnIndex (Index is 1-based)
     * @param sortBy
     */
    async sortColumnBy(columnIndex, sortBy) {
        await test_1.default.step(`Sort column ${columnIndex} by: ${sortBy}`, async () => {
            await this.selectColumnAction(columnIndex, sortBy);
        });
    }
    /**
     * Click a cell by its visual position (position is 0-based)
     * For example, if a column/row is pinned, the position would be index 0.
     */
    async clickCell(rowPosition, columnPosition, withShift = false) {
        await test_1.default.step(`Click cell by 0-based position: row ${rowPosition}, column ${columnPosition}`, async () => {
            withShift
                ? await this.cellByPosition(rowPosition, columnPosition).click({ modifiers: ['Shift'] })
                : await this.cellByPosition(rowPosition, columnPosition).click();
        });
    }
    /**
     * Click a cell by its index (Index is 0-based)
     * These indexes never change even with sorting, filtering, or pinning.
     */
    async clickCellByIndex(rowIndex, columnIndex, withShift = false) {
        await test_1.default.step(`Click cell by 0-based index: row ${rowIndex}, column ${columnIndex}`, async () => {
            withShift
                ? await this.cellByIndex(rowIndex, columnIndex).click({ modifiers: ['Shift'] })
                : await this.cellByIndex(rowIndex, columnIndex).click();
        });
    }
    /**
     * Shift-click a cell by its visual position (Index is 0-based)
     * For example, if a column/row is pinned, the position would be index 0.
     * @param rowIndex
     * @param columnIndex
     */
    async shiftClickCell(rowIndex, columnIndex) {
        await this.clickCell(rowIndex, columnIndex, true);
    }
    /**
     * Select a column action from the right-click menu.
     * @param colIndex (Index is 1-based)
     * @param action menu action to select
     */
    async selectColumnAction(colIndex, action) {
        await test_1.default.step(`Select column action: ${action}`, async () => {
            await this.code.driver.currentPage.locator(`div:nth-child(${colIndex}) > .content > .positron-button`).click();
            await this.code.driver.currentPage.getByRole('button', { name: action }).click();
        });
    }
    /**
     * Pin a column by its position
     * @param colPosition (position is 0-based)
     */
    async pinColumn(colPosition) {
        await test_1.default.step(`Pin column at 0-based position: ${colPosition}`, async () => {
            await this.jumpToStart(); // make sure we are at the start so our index is accurate
            await this.selectColumnAction(colPosition + 1, 'Pin Column'); // selectColumnAction is 1-based
        });
    }
    /**
     * Unpin a column by its position
     * @param colPosition (position is 0-based)
     */
    async unpinColumn(colPosition = 0) {
        await test_1.default.step(`Unpin column at 0-based position: ${colPosition}`, async () => {
            await this.jumpToStart(); // make sure we are at the start so our index is accurate
            await this.selectColumnAction(colPosition + 1, 'Unpin Column'); // selectColumnAction is 1-based
        });
    }
    /**
     * Copy a column by its position
     * @param colPosition (position is 0-based)
     */
    async copyColumn(colPosition) {
        await test_1.default.step(`Copy column at 0-based position: ${colPosition}`, async () => {
            await this.jumpToStart(); // make sure we are at the start so our index is accurate
            await this.selectColumnAction(colPosition + 1, 'Copy Column'); // selectColumnAction is 1-based
        });
    }
    /**
     * Pin a row by its position
     * @param rowPosition (position is 0-based)
     */
    async pinRow(rowPosition) {
        await test_1.default.step(`Pin row at 0-based position: ${rowPosition}`, async () => {
            await this.rowHeader.nth(rowPosition).click({ button: 'right' });
            await this.code.driver.currentPage.getByRole('button', { name: 'Pin Row' }).click();
        });
    }
    /**
     * Unpin a row by its position
     * @param rowPosition (position is 0-based)
     */
    async unpinRow(rowPosition = 0) {
        await test_1.default.step(`Unpin row at 0-based position: ${rowPosition}`, async () => {
            await this.code.driver.currentPage
                .locator(`.data-grid-row-headers > div:nth-child(${rowPosition + 1})`)
                .click({ button: 'right' });
            await this.code.driver.currentPage.getByRole('button', { name: 'Unpin Row' }).click();
        });
    }
    /**
     * Select a range of cells
     * @param start The starting cell position
     * @param end The ending cell position
     */
    async selectRange({ start, end }) {
        await test_1.default.step(`Select range: [${start.row}, ${start.col}] - [${end.row}, ${end.col}]`, async () => {
            await this.jumpToStart();
            await this.clickCell(start.row, start.col);
            await this.shiftClickCell(end.row, end.col);
        });
    }
    /**
     * Click a column header by its title
     * @param columnTitle The exact title of the column to click
     * @param options Optional parameters (e.g., right-click)
     */
    async clickColumnHeader(columnTitle, options) {
        await test_1.default.step(`Click column header: ${columnTitle}`, async () => {
            await this.columnHeaders.getByText(columnTitle).click({ button: options?.button ?? 'left' });
        });
    }
    /**
     * Click a row header by its position
     * Index is 1-based to match UI
     **/
    async clickRowHeader(rowIndex) {
        await test_1.default.step(`Click row header: ${rowIndex}`, async () => {
            await this.rowHeader.nth(rowIndex).click();
        });
    }
    // --- Getters ---
    async getRowCount() {
        const statusText = await this.statusBar.innerText();
        const match = statusText.match(/(\d+(?:,\d+)*)\s+rows?/);
        if (match && match[1]) {
            return parseInt(match[1].replace(/,/g, ''), 10);
        }
        return 0;
    }
    async getColumnCount() {
        const statusText = await this.statusBar.innerText();
        const match = statusText.match(/(\d+(?:,\d+)*)\s+columns?/);
        if (match && match[1]) {
            return parseInt(match[1].replace(/,/g, ''), 10);
        }
        return 0;
    }
    async getData() {
        await this.dataExplorer.waitForIdle();
        // need a brief additional wait
        await this.code.wait(1000);
        const allHeaders = await this.columnHeaders.all();
        const allRows = await this.rows.all();
        const headerNames = await Promise.all(allHeaders.map(async (header) => await header.textContent()));
        const tableData = [];
        for (const row of allRows) {
            const rowData = {};
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
    async getColumnHeaders() {
        const headersLocator = this.code.driver.currentPage.locator('div.column-name');
        return await headersLocator.allInnerTexts();
    }
    // --- Verifications ---
    /**
     * Verify that the column headers match the expected headers.
     * Note: assumes there are no duplicate column names.
     * @param expectedHeaders Array of expected column headers in the correct order
     */
    async expectColumnHeadersToBe(expectedHeaders) {
        await test_1.default.step(`Verify column headers (title, order): ${expectedHeaders}`, async () => {
            await this.jumpToStart();
            await this.clickCell(0, 0);
            const visibleHeaders = [];
            const maxScrollAttempts = await this.getColumnCount();
            let scrollAttempts = 0;
            // Get initial visible headers
            const initialHeaders = await this.columnHeaders.allInnerTexts();
            visibleHeaders.push(...initialHeaders);
            // Scroll right until we've collected all headers
            while (scrollAttempts < maxScrollAttempts) {
                // Press right arrow key to scroll horizontally
                await this.code.driver.currentPage.keyboard.press('ArrowRight');
                scrollAttempts++;
                // Get current visible headers after scrolling
                const currentHeaders = await this.columnHeaders.allInnerTexts();
                // Add any new headers we haven't seen yet
                for (const header of currentHeaders) {
                    if (!visibleHeaders.includes(header)) {
                        visibleHeaders.push(header);
                    }
                }
            }
            // Verify the length matches expected
            (0, test_1.expect)(visibleHeaders.length, `Expected headers: ${expectedHeaders.length}, Actual headers: ${visibleHeaders.length}`).toBe(expectedHeaders.length);
            // Verify each header matches expected in the correct order
            for (let i = 0; i < expectedHeaders.length; i++) {
                (0, test_1.expect)(visibleHeaders[i], `Col ${i}: Expected "${expectedHeaders[i]}", Actual: "${visibleHeaders[i]}"`).toBe(expectedHeaders[i]);
            }
        });
    }
    async verifyTableDataLength(expectedLength) {
        await test_1.default.step('Verify data explorer table data length', async () => {
            await (0, test_1.expect)(async () => {
                const tableData = await this.getData();
                (0, test_1.expect)(tableData.length).toBe(expectedLength);
            }).toPass({ timeout: 60000 });
        });
    }
    async verifyTableDataRowValue(rowIndex, expectedData) {
        await test_1.default.step(`Verify data explorer row ${rowIndex} data`, async () => {
            await (0, test_1.expect)(async () => {
                const tableData = await this.getData();
                const rowData = tableData[rowIndex];
                for (const [key, value] of Object.entries(expectedData)) {
                    (0, test_1.expect)(rowData[key]).toBe(value);
                }
            }).toPass({ timeout: 60000 });
        });
    }
    /**
     * Verify that the nth cell (default: last) has the expected content.
     * @param expectedContent The expected text content of the cell
     * @param cellIndex The index of the cell to check (default: last)
     */
    async expectCellContentAtIndexToBe(expectedContent, cellIndex) {
        await test_1.default.step(`Verify cell content at index ${cellIndex ?? 'last'}: ${expectedContent}`, async () => {
            const cells = this.code.driver.currentPage.locator('.data-grid-row-cell');
            const cell = cellIndex !== undefined ? cells.nth(cellIndex) : cells.last();
            await (0, test_1.expect)(cell).toHaveText(expectedContent);
        });
    }
    async expectCellContentToBe({ rowIndex, colIndex, value }) {
        await test_1.default.step(`Verify cell content at (${rowIndex}, ${colIndex}): ${value}`, async () => {
            await (0, test_1.expect)(async () => {
                const cell = this.grid.locator(`#data-grid-row-cell-content-${colIndex}-${rowIndex}`);
                await (0, test_1.expect)(cell).toHaveText(String(value));
            }).toPass();
        });
    }
    async expectRangeToBeSelected(expectedRange) {
        await test_1.default.step(`Verify selection range: ${JSON.stringify(expectedRange)}`, async () => {
            const selectedCells = this.grid.locator('.selection-overlay');
            await (0, test_1.expect)(selectedCells).toHaveCount((expectedRange.rows.length) * (expectedRange.cols.length));
            for (const row of expectedRange.rows) {
                for (const col of expectedRange.cols) {
                    const cell = this.grid.locator(`#data-grid-row-cell-content-${col}-${row}`);
                    await (0, test_1.expect)(cell.locator('..').locator('.selection-overlay')).toBeVisible();
                }
            }
        });
    }
    async verifyTableData(expectedData, timeout = 60000) {
        await test_1.default.step('Verify data explorer data', async () => {
            await (0, test_1.expect)(async () => {
                const tableData = await this.getData();
                (0, test_1.expect)(tableData.length).toBe(expectedData.length);
                for (let i = 0; i < expectedData.length; i++) {
                    const row = expectedData[i];
                    for (const [key, expectedValue] of Object.entries(row)) {
                        const actualValue = tableData[i][key];
                        (0, test_1.expect)(this.normalize(actualValue)).toBe(this.normalize(expectedValue));
                    }
                }
            }).toPass({ timeout });
        });
    }
    /**
     * Assert that only the given columns are pinned, in order.
     *
     * @param expectedTitles Array of column titles in the expected pinned order
     */
    async expectColumnsToBePinned(expectedTitles) {
        await test_1.default.step(`Verify pinned columns: ${expectedTitles}`, async () => {
            const pinnedColumns = this.code.driver.currentPage.locator('.data-grid-column-header.pinned');
            if (expectedTitles.length === 0) {
                await (0, test_1.expect)(pinnedColumns).toHaveCount(0);
            }
            else {
                await (0, test_1.expect)(pinnedColumns).toHaveCount(expectedTitles.length);
                // Assert each pinned column has the correct title, in order
                for (let i = 0; i < expectedTitles.length; i++) {
                    const title = pinnedColumns.nth(i).locator('.title');
                    await (0, test_1.expect)(title).toHaveText(expectedTitles[i]);
                }
            }
        });
    }
    async expectRowsToBePinned(expectedRows, indexOffset = 0) {
        await test_1.default.step(`Verify pinned rows: ${expectedRows}`, async () => {
            const pinnedRows = this.code.driver.currentPage.locator('.data-grid-row-header.pinned');
            if (expectedRows.length === 0) {
                // If we expect no pinned rows, verify count is 0
                await (0, test_1.expect)(pinnedRows).toHaveCount(0);
                return;
            }
            for (let i = 0; i < expectedRows.length; i++) {
                const content = pinnedRows.nth(i).locator('.content');
                await (0, test_1.expect)(content).toHaveText(String(expectedRows[i] + indexOffset));
            }
        });
    }
    async expectColumnCountToBe(expectedCount) {
        await test_1.default.step('Verify column count', async () => {
            const actualCount = await this.getColumnHeaders();
            (0, test_1.expect)(actualCount.length).toBe(expectedCount);
        });
    }
    async expectRowOrderToBe(expectedOrder, indexOffset = 0) {
        await test_1.default.step(`Verify row order: ${expectedOrder}`, async () => {
            const rowHeaders = this.code.driver.currentPage.locator('.data-grid-row-headers > .data-grid-row-header .content');
            const actualOrder = await rowHeaders.allInnerTexts();
            const actualOrderNumbers = actualOrder.map(text => parseInt(text, 10));
            (0, test_1.expect)(actualOrderNumbers).toEqual(expectedOrder.map(num => num + indexOffset));
        });
    }
    async expectCellToBeSelected(row, col) {
        await test_1.default.step(`Verify cell at (${row}, ${col}) is selected`, async () => {
            await (0, test_1.expect)(this.cellByPosition(row, col).locator('.border-overlay .cursor-border')).toBeVisible();
        });
    }
    // --- Utils ---
    normalize(value) {
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
exports.DataGrid = DataGrid;
// ----------------------
//     Summary Panel
// ----------------------
class SummaryPanel {
    code;
    workbench;
    summaryPanel;
    summaryFilterBar;
    searchFilter;
    sortFilter;
    columnSummary;
    columnSummaryName;
    verticalScrollbar;
    vectorHistogram;
    constructor(code, workbench) {
        this.code = code;
        this.workbench = workbench;
        this.summaryFilterBar = this.code.driver.currentPage.locator('.summary-row-filter-bar');
        this.summaryPanel = this.summaryFilterBar.locator('..');
        this.searchFilter = this.summaryFilterBar.getByRole('textbox', { name: 'filter' });
        this.sortFilter = this.summaryFilterBar.getByRole('button', { name: 'Sort summary row data' });
        this.columnSummary = this.summaryPanel.locator('.column-summary');
        this.columnSummaryName = this.columnSummary.locator('.column-name');
        this.verticalScrollbar = this.summaryPanel.locator('div.data-grid-scrollbar-slider');
        this.vectorHistogram = this.summaryPanel.locator('.vector-histogram');
    }
    // --- Actions ---
    async hide() {
        await this.workbench.hotKeys.hideDataExplorerSummaryPanel();
    }
    async show(position = 'left') {
        position === 'left'
            ? await this.workbench.hotKeys.showDataExplorerSummaryPanel()
            : await this.workbench.hotKeys.showDataExplorerSummaryPanelRight();
    }
    async search(filterText) {
        await test_1.default.step('Search summary panel', async () => {
            await this.searchFilter.fill(filterText);
            await this.searchFilter.press('Enter');
        });
    }
    async clearSearch() {
        await test_1.default.step('Clear search filter in summary panel', async () => {
            await this.searchFilter.fill('');
            await this.searchFilter.press('Enter');
        });
    }
    async sortBy(sortBy) {
        await test_1.default.step('Sort summary panel', async () => {
            await this.workbench.contextMenu.triggerAndClick({
                menuTrigger: this.sortFilter,
                menuItemType: 'menuitemcheckbox',
                menuItemLabel: `Sort by ${sortBy}`
            });
        });
    }
    async clearSort() {
        await test_1.default.step('Clear sort in summary panel', async () => {
            await this.sortBy('Original');
        });
    }
    async expandColumnProfile(rowNumber = 0) {
        await this.code.driver.currentPage.locator(EXPAND_COLLASPE_ICON).nth(rowNumber).click();
    }
    async waitForVectorHistogramVisible(timeout = 10000) {
        await this.vectorHistogram.first().waitFor({ state: 'visible', timeout });
    }
    async hoverHistogramBinWithRange(expectedMin, expectedMax) {
        const bins = this.summaryPanel.locator('.vector-histogram foreignObject.tooltip-container');
        const count = await bins.count();
        if (count === 0) {
            throw new Error('No histogram bins found');
        }
        for (let i = 0; i < count; i++) {
            await bins.nth(i).hover();
            const tooltip = this.code.driver.currentPage.locator('.hover-contents');
            await tooltip.waitFor({ state: 'visible', timeout: 5000 });
            const text = await tooltip.innerText();
            if (text.includes(`Range: ${expectedMin} to ${expectedMax}`)) {
                return;
            }
        }
        throw new Error(`No bin tooltip matched Range: ${expectedMin} to ${expectedMax}`);
    }
    // --- Getters ---
    async getColumnMissingPercent(rowNumber) {
        const row = this.code.driver.currentPage.locator(MISSING_PERCENT(rowNumber));
        return await row.innerText();
    }
    async getColumnProfileInfo(rowNumber) {
        const expandCollapseLocator = this.code.driver.currentPage.locator(EXPAND_COLLAPSE_PROFILE(rowNumber));
        await expandCollapseLocator.scrollIntoViewIfNeeded();
        await expandCollapseLocator.click();
        await (0, test_1.expect)(expandCollapseLocator.locator(EXPAND_COLLASPE_ICON)).toHaveClass(/codicon-chevron-down/);
        const profileData = {};
        const labelsLocator = this.code.driver.currentPage.locator(PROFILE_LABELS(rowNumber));
        await test_1.expect.poll(async () => (await labelsLocator.all()).length).toBeGreaterThan(2);
        const labels = await labelsLocator.all();
        const valuesLocator = this.code.driver.currentPage.locator(PROFILE_VALUES(rowNumber));
        await test_1.expect.poll(async () => (await valuesLocator.all()).length).toBeGreaterThan(2);
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
        const containers = await this.code.driver.currentPage.locator(`${profileAreaSelector} foreignObject.tooltip-container`).all();
        const profileSparklineHeights = [];
        for (let i = 0; i < containers.length; i++) {
            const height = await containers[i].getAttribute('data-height');
            if (height !== null) {
                const rounded = parseFloat(height).toFixed(1); // Round to one decimal place
                profileSparklineHeights.push(rounded);
            }
        }
        await expandCollapseLocator.scrollIntoViewIfNeeded();
        await expandCollapseLocator.click();
        await (0, test_1.expect)(expandCollapseLocator.locator(EXPAND_COLLASPE_ICON)).toHaveClass(/codicon-chevron-right/);
        const profileInfo = {
            profileData: profileData,
            profileSparklineHeights: profileSparklineHeights
        };
        return profileInfo;
    }
    // --- Verifications ---
    async expectSortToBeBy(sortBy) {
        await test_1.default.step('Verify sort order in summary panel', async () => {
            await (0, test_1.expect)(this.sortFilter).toHaveText(`Sort by ${sortBy}`);
        });
    }
    async expectColumnCountToBe(count) {
        await test_1.default.step('Verify column count in summary panel', async () => {
            await (0, test_1.expect)(this.columnSummary).toHaveCount(count);
        });
    }
    async expectColumnNameToBe(columnProfileIndex, expectedName) {
        await test_1.default.step(`Verify column ${columnProfileIndex} name is "${expectedName}"`, async () => {
            const columnName = this.columnSummaryName.nth(columnProfileIndex);
            await (0, test_1.expect)(columnName).toHaveText(expectedName);
        });
    }
    async expectColumnOrderToBe(columnNames) {
        await test_1.default.step('Verify column order in summary panel', async () => {
            await (0, test_1.expect)(async () => {
                const actualOrder = await this.columnSummaryName.allInnerTexts();
                (0, test_1.expect)(actualOrder).toEqual(columnNames);
            }, 'summary panel column order').toPass({ timeout: 5000 });
        });
    }
    async expectColumnToBe({ index, name, expanded }) {
        await test_1.default.step(`Expect col [${index}] to be: "${name}", ${expanded ? 'expanded' : 'collapsed'}`, async () => {
            expanded
                ? await this.expectColumnProfileToBeExpanded(index)
                : await this.expectColumnProfileToBeCollapsed(index);
            await this.expectColumnNameToBe(index, name);
        });
    }
    async expectScrollbarToBeVisible(visible = true) {
        await test_1.default.step(`Verify vertical scrollbar: ${visible ? 'visible' : 'not visible'}`, async () => {
            visible
                ? await (0, test_1.expect)(this.verticalScrollbar).toBeVisible({ timeout: 5000 })
                : await (0, test_1.expect)(this.verticalScrollbar).not.toBeVisible({ timeout: 5000 });
        });
    }
    async verifyMissingPercent(expectedValues) {
        await test_1.default.step('Verify missing percent values', async () => {
            for (const { column, expected } of expectedValues) {
                const missingPercent = await this.getColumnMissingPercent(column);
                (0, test_1.expect)(missingPercent).toBe(expected);
            }
        });
    }
    async expectColumnProfileToBeExpanded(columnProfileIndex) {
        await this.expectColumnSummaryIndexExpansion(columnProfileIndex, 'expanded');
    }
    async expectColumnProfileToBeCollapsed(columnProfileIndex) {
        await this.expectColumnSummaryIndexExpansion(columnProfileIndex, 'collapsed');
    }
    async expectColumnSummaryIndexExpansion(columnProfileIndex, expansion) {
        await test_1.default.step(`Verify column ${columnProfileIndex} is ${expansion}`, async () => {
            // Verify chevron direction
            const column = this.columnSummary.nth(columnProfileIndex);
            if (expansion === 'expanded') {
                await (0, test_1.expect)(column.locator('.codicon-chevron-down'), 'column should have down chevron').toBeVisible();
            }
            else {
                await (0, test_1.expect)(column.locator('.codicon-chevron-right'), 'column should have right chevron').toBeVisible();
            }
            // Verify expansion
            const box = await column.boundingBox();
            (0, test_1.expect)(box).not.toBeNull();
            if (expansion === 'expanded') {
                (0, test_1.expect)(box.height, 'column should be expanded vertically').toBeGreaterThan(100);
            }
            else {
                (0, test_1.expect)(box.height, 'column should be collapsed vertically').toBeLessThan(100);
            }
        });
    }
    async verifyColumnData(expectedValues) {
        await test_1.default.step('Verify column data', async () => {
            for (const { column, expected } of expectedValues) {
                const profileInfo = await this.getColumnProfileInfo(column);
                (0, test_1.expect)(profileInfo.profileData).toStrictEqual(expected);
            }
        });
    }
    async verifySparklineHoverDialog(verificationText) {
        await test_1.default.step(`Verify sparkline tooltip: ${verificationText}`, async () => {
            // Try the proper selector first, then fallback to direct vector components
            // This handles both expanded profiles (with .column-profile-sparkline wrapper)
            // and collapsed headers (direct vector components)
            const firstSparkline = this.code.driver.currentPage.locator('.column-profile-sparkline foreignObject.tooltip-container, .vector-histogram foreignObject.tooltip-container, .vector-frequency-table foreignObject.tooltip-container').nth(0);
            await firstSparkline.hover();
            const hoverTooltip = this.code.driver.currentPage.locator('.hover-contents');
            await (0, test_1.expect)(hoverTooltip).toBeVisible();
            for (const text of verificationText) {
                await (0, test_1.expect)(hoverTooltip).toContainText(text);
            }
        });
    }
    async verifySparklineHeights(expectedHeights) {
        await test_1.default.step('Verify sparkline heights', async () => {
            for (const { column, expected } of expectedHeights) {
                const colProfileInfo = await this.getColumnProfileInfo(column);
                (0, test_1.expect)(colProfileInfo.profileSparklineHeights).toStrictEqual(expected);
            }
        });
    }
    async verifyNullPercentHoverDialog() {
        await test_1.default.step('Verify null percent hover dialog', async () => {
            const firstNullPercent = this.code.driver.currentPage.locator('.column-null-percent').nth(0);
            await firstNullPercent.hover();
            const hoverTooltip = this.code.driver.currentPage.locator('.hover-contents');
            await (0, test_1.expect)(hoverTooltip).toBeVisible();
            // After streamlining, tooltip shows either "No missing values" or "X% of values are missing"
            await (0, test_1.expect)(hoverTooltip).toContainText(/No missing values|of values are missing/);
        });
    }
}
exports.SummaryPanel = SummaryPanel;
// -----------------------------
//    Convert to Code Modal
// -----------------------------
class ConvertToCodeModal {
    code;
    workbench;
    codeBox;
    constructor(code, workbench) {
        this.code = code;
        this.workbench = workbench;
        this.codeBox = this.code.driver.currentPage.locator('.positron-modal-dialog-box .convert-to-code-editor');
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
        await test_1.default.step('Verify convert to code modal is visible', async () => {
            await (0, test_1.expect)(this.codeBox).toBeVisible();
            await this.workbench.modals.expectButtonToBeVisible('Copy Code');
            await this.workbench.modals.expectButtonToBeVisible('Cancel');
        });
    }
    async expectSyntaxHighlighting() {
        await test_1.default.step('Verify syntax highlighting', async () => {
            // Verify code highlighting - more than one style means highlighting is active
            const mtkLocator = this.code.driver.currentPage.locator('[class*="mtk"]');
            const tokenClasses = await mtkLocator.evaluateAll(spans => Array.from(new Set(spans.flatMap(span => Array.from(span.classList))
                .filter(cls => cls.startsWith('mtk')))));
            (0, test_1.expect)(tokenClasses.length).toBeGreaterThan(1);
            // Verify bracket highlighting
            const bracketHighlightingCount = await this.code.driver.currentPage.locator('[class*="bracket-highlighting-"]').count();
            (0, test_1.expect)(bracketHighlightingCount).toBeGreaterThan(0);
        });
    }
}
exports.ConvertToCodeModal = ConvertToCodeModal;
//# sourceMappingURL=dataExplorer.js.map