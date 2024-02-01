/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { IColumnSortKey } from 'vs/base/browser/ui/dataGrid/interfaces/columnSortKey';
import { DataGridInstance } from 'vs/base/browser/ui/dataGrid/classes/dataGridInstance';
import { PositronDataToolColumn } from 'vs/workbench/services/positronDataTool/browser/positronDataToolColumn';
import { DataToolClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataToolClient';
import { ColumnSortKey, TableData, TableSchema } from 'vs/workbench/services/languageRuntime/common/positronDataToolComm';

interface CachedTableData {
	firstColumnIndex: number;
	columnIndices: number[];

	firstRowIndex: number;
	lastRowIndex: number;

	tableData: TableData;
}

/**
 * PositronDataToolDataGridInstance class.
 */
export class PositronDataToolDataGridInstance extends DataGridInstance {
	/**
	 * Gets the data tool client instance.
	 */
	private readonly _dataToolClientInstance: DataToolClientInstance;

	private _tableSchema?: TableSchema;

	private _lastFetchIdentifier = '';

	private _cachedTableData?: CachedTableData;

	constructor(dataToolClientInstance: DataToolClientInstance) {
		// Call the base class's constructor.
		super({
			columnHeadersHeight: 34,
			rowHeadersWidth: 55,
			minimumColumnWidth: 100,
			scrollbarWidth: 14
		});

		// Set the data tool client instance.
		this._dataToolClientInstance = dataToolClientInstance;
	}

	/**
	 * Gets the number of rows.
	 */
	get rows() {
		if (!this._tableSchema) {
			return 0;
		} else {
			return this._tableSchema?.num_rows;
		}
	}

	/**
	 *
	 */
	initialize() {
		this._dataToolClientInstance.getSchema().then(tableSchema => {

			console.log(`++++++++++ Schema returned with ${tableSchema.columns.length} columns`);

			this._tableSchema = tableSchema;

			const columns: PositronDataToolColumn[] = [];
			for (let i = 0; i < tableSchema.columns.length; i++) {
				columns.push(new PositronDataToolColumn(tableSchema.columns[i]));
			}

			this.setColumns(columns);

			// Fetch data.
			this.fetchData();
		}).catch(x => {

		});
	}

	/**
	 * Sorts the data.
	 * @returns A Promise<void> that resolves when the data is sorted.
	 */
	async sortData(columnSorts: IColumnSortKey[]): Promise<void> {
		// Set the sort columns.
		await this._dataToolClientInstance.setSortColumns(columnSorts.map(columnSort => (
			{
				column_index: columnSort.columnIndex,
				ascending: columnSort.ascending
			} satisfies ColumnSortKey
		)));

		// Refetch data.
		await this.doFetchData();
	}

	private async doFetchData(): Promise<void> {
		// If the table schema hasn't loaded, we cannot fetch data.
		if (!this._tableSchema) {
			return;
		}

		// Set the first column index and first row index.
		const firstColumnIndex = this.firstColumnIndex;
		const firstRowIndex = this.firstRowIndex;

		// Build the column indices to fetch.
		const columnIndices: number[] = [];
		for (let i = this.firstColumnIndex; i < Math.min(this.firstColumnIndex + this.visibleColumns + 1, this.columns); i++) {
			columnIndices.push(i);
		}

		// Generate a fetch identifier.
		const fetchIdentifier = this._lastFetchIdentifier = generateUuid();

		// Fetch data.
		const start = new Date().getTime();
		const tableData = await this._dataToolClientInstance.getDataValues(
			firstRowIndex,
			this.visibleRows + 10,
			columnIndices
		);


		if (fetchIdentifier !== this._lastFetchIdentifier) {
			console.log('+++++++++++++++++++ DISCARDING FETCHED DATA');
		}

		const end = new Date().getTime();
		console.log(`Fetching data took ${end - start}ms`);

		// Set the cached data.
		this._cachedTableData = {
			firstColumnIndex,
			columnIndices,
			firstRowIndex,
			lastRowIndex: firstRowIndex + this.visibleRows + 10,
			tableData
		} satisfies CachedTableData;

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	fetchData() {
		this.doFetchData().then(() => {

		}).catch(x => {
			console.log(x);
		});
	}

	/**
	 * Gets a row label.
	 * @param rowIndex The row index.
	 * @returns The row label.
	 */
	rowLabel(rowIndex: number) {
		// If there isn't any cached data, return undefined.
		if (!this._cachedTableData) {
			return undefined;
		}

		// If the row isn't cached, return undefined.
		if (rowIndex < this._cachedTableData.firstRowIndex ||
			rowIndex > this._cachedTableData.lastRowIndex
		) {
			return undefined;
		}

		// If there are no row labels, return the row index.
		if (!this._cachedTableData.tableData.row_labels) {
			return `${rowIndex + 1}`;
		}

		// Calculate the cached row index.
		const cachedRowIndex = rowIndex - this._cachedTableData.firstRowIndex;

		// Return the cached row label.
		return this._cachedTableData.tableData.row_labels[0][cachedRowIndex];
	}

	/**
	 * Gets a cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell.
	 */
	cell(columnIndex: number, rowIndex: number): string | undefined {
		// If there isn't any cached data, return undefined.
		if (!this._cachedTableData) {
			return undefined;
		}

		// If the row isn't cached, return undefined.
		if (rowIndex < this._cachedTableData.firstRowIndex ||
			rowIndex > this._cachedTableData.lastRowIndex
		) {
			return undefined;
		}

		// If the column isn't cached, return undefined.
		const colIndex = this._cachedTableData.columnIndices.indexOf(columnIndex);
		if (colIndex === -1) {
			return undefined;
		}

		// Calculate the cached row index.
		const cachedRowIndex = rowIndex - this._cachedTableData.firstRowIndex;

		// Return the cached value.
		return this._cachedTableData.tableData.columns[colIndex][cachedRowIndex];
	}
}
