/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';

const COLUMN_HEADERS = '.data-explorer-panel .column-2 .data-grid-column-headers';
const HEADER_TITLES = '.data-grid-column-header .title-description .title';
const DATA_GRID_ROWS = '.data-explorer-panel .column-2 .data-grid-rows';
const DATA_GRID_ROW = '.data-grid-row';
const CLOSE_DATA_EXPLORER = '.tab .codicon-close';
const IDLE_STATUS = '.status-bar-indicator .icon.idle';
const SCROLLBAR_LOWER_RIGHT_CORNER = '.data-grid-scrollbar-corner';
const DATA_GRID_TOP_LEFT = '.data-grid-corner-top-left';
const ADD_FILTER_BUTTON = '.codicon-positron-add-filter';
const COLUMN_SELECTOR = '.positron-modal-overlay .drop-down-column-selector';
const COLUMN_INPUT = '.positron-modal-overlay .column-search-input .text-input';
const COLUMN_SELECTOR_CELL = '.column-selector-cell';
const FUNCTION_SELECTOR = '.positron-modal-overlay .drop-down-list-box';
const FILTER_SELECTOR = '.positron-modal-overlay .row-filter-parameter-input .text-input';
const APPLY_FILTER = '.positron-modal-overlay .button-apply-row-filter';
const STATUS_BAR = '.positron-data-explorer .status-bar';
const OVERLAY_BUTTON = '.positron-modal-overlay .positron-button';

export interface CellData {
	[key: string]: string;
}

export class PositronDataExplorer {

	constructor(private code: Code) { }

	async getDataExplorerTableData(): Promise<object[]> {

		await this.code.waitForElement(IDLE_STATUS);

		// we have seen intermittent failures where the data explorer is not fully loaded
		// even though the status bar is idle. This wait is to ensure the data explorer is fully loaded
		// chosing 100ms as a safe wait time because waitForElement polls at 100ms
		await this.code.wait(100);

		const headers = await this.code.waitForElements(`${COLUMN_HEADERS} ${HEADER_TITLES}`, false);
		const rows = await this.code.waitForElements(`${DATA_GRID_ROWS} ${DATA_GRID_ROW}`, true);
		const headerNames = headers.map((header) => header.textContent);

		const tableData: object[] = [];
		for (const row of rows) {
			const rowData: CellData = {};
			let columnIndex = 0;
			for (const cell of row.children) {
				const innerText = cell.textContent;
				const headerName = headerNames[columnIndex];
				// workaround for extra offscreen cells
				if (!headerName) {
					continue;
				}
				rowData[headerName] = innerText;
				columnIndex++;
			}
			tableData.push(rowData);
		}

		return tableData;
	}

	async closeDataExplorer() {
		await this.code.waitAndClick(CLOSE_DATA_EXPLORER);
	}

	async clickLowerRightCorner() {
		await this.code.waitAndClick(SCROLLBAR_LOWER_RIGHT_CORNER);
	}

	async clickUpperLeftCorner() {
		await this.code.waitAndClick(DATA_GRID_TOP_LEFT);
	}

	async addFilter(columnName: string, functionText: string, filterValue: string) {

		await this.code.waitAndClick(ADD_FILTER_BUTTON);

		await this.code.waitAndClick(COLUMN_SELECTOR);

		const columnText = `${columnName}\n`;
		await this.code.waitForSetValue(COLUMN_INPUT, columnText);

		await this.code.waitAndClick(COLUMN_SELECTOR_CELL);

		await this.code.waitAndClick(FUNCTION_SELECTOR);

		// note that base Microsoft funtionality does not work with "has text" type selection
		const equalTo = this.code.driver.getLocator(`${OVERLAY_BUTTON} div:has-text("${functionText}")`);
		await equalTo.click();

		const filterValueText = `${filterValue}\n`;
		await this.code.waitForSetValue(FILTER_SELECTOR, filterValueText);

		await this.code.waitAndClick(APPLY_FILTER);
	}

	async getDataExplorerStatusBar() {
		return await this.code.waitForElement(STATUS_BAR, (e) => e!.textContent.includes('Showing'));
	}
}
