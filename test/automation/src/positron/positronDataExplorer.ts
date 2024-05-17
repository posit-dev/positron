/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Code } from '../code';

const COLUMN_HEADERS = '.data-explorer-panel .column-2 .data-grid-column-headers';
const HEADER_TITLES = '.data-grid-column-header .title-description .title';
const DATA_GRID_ROWS = '.data-explorer-panel .column-2 .data-grid-rows';
const DATA_GRID_ROW = '.data-grid-row';
const CLOSE_DATA_EXPLORER = '.tab .codicon-close';

export interface CellData {
	[key: string]: string;
}

export class PositronDataExplorer {

	constructor(private code: Code) { }

	async getDataExplorerTableData(expectedColumns: number, expectedRows: number): Promise<object[]> {

		const headers = await this.code.waitForElements(`${COLUMN_HEADERS} ${HEADER_TITLES}`, false, (elements) => elements.length === expectedColumns);
		const rows = await this.code.waitForElements(`${DATA_GRID_ROWS} ${DATA_GRID_ROW}`, true, (elements) => elements.length === expectedRows);
		const headerNames = headers.map((header) => header.textContent);

		const tableData: object[] = [];
		for (const row of rows) {
			const rowData: CellData = {};
			let columnIndex = 0;
			for (const cell of row.children) {
				const innerText = cell.textContent;
				const headerName = headerNames[columnIndex];
				// workaround for extra offscreen cells
				if (headerName === undefined) {
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
}
