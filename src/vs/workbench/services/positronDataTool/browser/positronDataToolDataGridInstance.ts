/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DataGridInstance } from 'vs/base/browser/ui/dataGrid/classes/dataGridInstance';
import { generateUuid } from 'vs/base/common/uuid';
import { DataToolClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataToolClient';
import { TableData, TableSchema } from 'vs/workbench/services/languageRuntime/common/positronDataToolComm';
import { PositronDataToolColumn } from 'vs/workbench/services/positronDataTool/browser/positronDataToolColumn';

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

	private readonly _dataToolClientInstance: DataToolClientInstance;

	private _tableSchema?: TableSchema;

	private _lastFetchIdentifier = '';

	private _cachedTableData?: CachedTableData;

	constructor(dataToolClientInstance: DataToolClientInstance) {
		// Call the base class's constructor.
		super();

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
				columns.push(new PositronDataToolColumn(
					`col-${i}`,
					tableSchema.columns[i]
				));
			}

			this.setColumns(columns);

			// Fetch data.
			this.fetchData();
		}).catch(x => {

		});

	}

	fetchData() {
		// If the table schema hasn't loaded, we cannot fetch data.
		if (!this._tableSchema) {
			return;
		}

		// Figure out the optimal columns to cache. Small numbe of columns, cache them all. Otherwise,
		// cache N before the visible columns and N after.

		// Figure out the optimal rows to cache.

		// Is that data already cached. If so, do nothing.

		// get more

		// Set the first column index and first row index.
		const firstColumnIndex = this.firstColumnIndex;
		const firstRowIndex = this.firstRowIndex;

		// If the data we need to fetch is already cached, do nothing.


		// Build the column indices to fetch.
		const columnIndices: number[] = [];
		for (let i = this.firstColumnIndex; i < Math.min(this.firstColumnIndex + this.visibleColumns + 1, this.columns); i++) {
			columnIndices.push(i);
		}

		// Generate a fetch identifier.
		const fetchIdentifier = this._lastFetchIdentifier = generateUuid();

		// Fetch data.
		const start = new Date().getTime();
		this._dataToolClientInstance.getDataValues(
			firstRowIndex,
			this.visibleRows + 10,
			columnIndices
		).then(tableData => {
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

		}).catch(x => {
			console.log(x);
		});
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

		// Return the cached value.
		return this._cachedTableData.tableData.columns[colIndex][rowIndex - this._cachedTableData.firstRowIndex];
	}
}
