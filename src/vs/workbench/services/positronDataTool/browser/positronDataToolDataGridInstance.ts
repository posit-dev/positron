/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IColumnSortKey } from 'vs/base/browser/ui/dataGrid/interfaces/columnSortKey';
import { DataGridInstance } from 'vs/base/browser/ui/dataGrid/classes/dataGridInstance';
import { PositronDataToolColumn } from 'vs/workbench/services/positronDataTool/browser/positronDataToolColumn';
import { DataToolClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataToolClient';
import { ColumnSortKey, TableSchema } from 'vs/workbench/services/languageRuntime/common/positronDataToolComm';
import { FetchRange, FetchResult, PositronDataToolCache } from 'vs/workbench/services/positronDataTool/common/positronDataToolCache';

/**
 * PositronDataToolDataGridInstance class.
 */
export class PositronDataToolDataGridInstance extends DataGridInstance {
	/**
	 * Gets the data tool client instance.
	 */
	private readonly _dataToolClientInstance: DataToolClientInstance;

	private _tableSchema?: TableSchema;

	private _cache?: PositronDataToolCache;

	private _lastFetchResult?: FetchResult;

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

			this._cache = new PositronDataToolCache(
				[tableSchema.num_rows, tableSchema.total_num_columns],
				async (req: FetchRange) => {
					const start = new Date().getTime();

					// Build the column indices to fetch.
					const columnIndices: number[] = [];
					for (let i = req.columnStartIndex; i < req.columnEndIndex; i++) {
						columnIndices.push(i);
					}

					const data = await this._dataToolClientInstance.getDataValues(
						req.rowStartIndex,
						req.rowEndIndex - req.rowStartIndex,
						columnIndices
					);
					const end = new Date().getTime();
					console.log(`Fetching data took ${end - start}ms`);
					return data;
				});

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
		this.resetCache();
		await this.doFetchData();
	}

	private resetCache() {
		// Clear the data cache
		this._cache?.clear();
		this._lastFetchResult = undefined;
	}

	private async doFetchData(): Promise<void> {
		// If the table schema hasn't loaded, we cannot fetch data.
		if (!this._tableSchema) {
			return;
		}

		const rangeToFetch: FetchRange = {
			rowStartIndex: this.firstRowIndex,
			rowEndIndex: this.firstRowIndex + this.visibleRows,
			columnStartIndex: this.firstColumnIndex,

			// TODO: column edge detection can cause visibleColumns to be one less than what the
			// user actually sees, so we fudge this for now
			columnEndIndex: this.firstColumnIndex + this.visibleColumns + 1
		};

		if (this.needToFetch(rangeToFetch)) {
			this._lastFetchResult = await this._cache?.fetch(rangeToFetch);
		}

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	private needToFetch(range: FetchRange) {
		if (!this._lastFetchResult) {
			return true;
		} else {
			return !PositronDataToolCache.rangeIncludes(range, this._lastFetchResult);
		}
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
		if (!this._lastFetchResult) {
			return undefined;
		}

		// If the row isn't cached, return undefined.
		if (rowIndex < this._lastFetchResult.rowStartIndex ||
			rowIndex > this._lastFetchResult.rowEndIndex
		) {
			return undefined;
		}

		// If there are no row labels, return the row index.
		if (!this._lastFetchResult.data.row_labels) {
			return `${rowIndex + 1}`;
		}

		// Calculate the cached row index.
		const cachedRowIndex = rowIndex - this._lastFetchResult.rowStartIndex;

		// Return the cached row label.
		return this._lastFetchResult.data.row_labels[0][cachedRowIndex];
	}

	/**
	 * Gets a cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell.
	 */
	cell(columnIndex: number, rowIndex: number): string | undefined {
		// If there isn't any cached data, return undefined.
		if (!this._lastFetchResult) {
			return undefined;
		}

		// If the cell isn't cached, return undefined.
		if (rowIndex < this._lastFetchResult.rowStartIndex ||
			rowIndex >= this._lastFetchResult.rowEndIndex ||
			columnIndex < this._lastFetchResult.columnStartIndex ||
			columnIndex >= this._lastFetchResult.columnEndIndex
		) {
			return undefined;
		}

		// Calculate the cache indices.
		const cachedRowIndex = rowIndex - this._lastFetchResult.rowStartIndex;
		const cachedColIndex = columnIndex - this._lastFetchResult.columnStartIndex;

		// Return the cached value.
		return this._lastFetchResult.data.columns[cachedColIndex][cachedRowIndex];
	}
}
