/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies.
import { IColumnSortKey } from 'vs/base/browser/ui/positronDataGrid/interfaces/columnSortKey';
import { DataGridInstance } from 'vs/base/browser/ui/positronDataGrid/classes/dataGridInstance';
import { TableDataCell } from 'vs/workbench/services/positronDataExplorer/browser/components/tableDataCell';
import { ColumnSortKey, TableSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { TableDataRowHeader } from 'vs/workbench/services/positronDataExplorer/browser/components/tableDataRowHeader';
import { PositronDataExplorerColumn } from 'vs/workbench/services/positronDataExplorer/browser/positronDataExplorerColumn';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { FetchRange, FetchResult, PositronDataExplorerCache } from 'vs/workbench/services/positronDataExplorer/common/positronDataExplorerCache';

/**
 * TableDataDataGridInstance class.
 */
export class TableDataDataGridInstance extends DataGridInstance {
	//#region Private Properties

	/**
	 * Gets the data explorer client instance.
	 */
	private readonly _dataExplorerClientInstance: DataExplorerClientInstance;

	private _tableSchema?: TableSchema;

	private _cache?: PositronDataExplorerCache;

	private _lastFetchResult?: FetchResult;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param dataExplorerClientInstance The DataExplorerClientInstance.
	 */
	constructor(dataExplorerClientInstance: DataExplorerClientInstance) {
		// Call the base class's constructor.
		super({
			columnHeaders: true,
			columnHeadersHeight: 34,

			rowHeaders: true,
			rowHeadersWidth: 55,
			rowHeadersResize: true,

			defaultColumnWidth: 200,
			defaultRowHeight: 24,

			columnResize: true,
			minimumColumnWidth: 100,

			rowResize: false,

			horizontalScrollbar: true,
			verticalScrollbar: true,
			scrollbarWidth: 14,

			cellBorder: true
		});

		// Set the data explorer client instance.
		this._dataExplorerClientInstance = dataExplorerClientInstance;
	}

	//#endregion Constructor

	/**
	 * Gets the number of columns.
	 */
	get columns() {
		return this._tableSchema ? this._tableSchema.total_num_columns : 0;
	}

	/**
	 * Gets the number of rows.
	 */
	get rows() {
		return this._tableSchema ? this._tableSchema.num_rows : 0;
	}

	/**
	 *
	 */
	initialize() {
		this._dataExplorerClientInstance.getSchema().then(tableSchema => {

			console.log(`++++++++++ Schema returned with ${tableSchema.columns.length} columns`);

			this._tableSchema = tableSchema;

			this._cache = new PositronDataExplorerCache(
				[tableSchema.num_rows, tableSchema.total_num_columns],
				async (req: FetchRange) => {
					const start = new Date().getTime();

					// Build the column indices to fetch.
					const columnIndices: number[] = [];
					for (let i = req.columnStartIndex; i < req.columnEndIndex; i++) {
						columnIndices.push(i);
					}

					const data = await this._dataExplorerClientInstance.getDataValues(
						req.rowStartIndex,
						req.rowEndIndex - req.rowStartIndex,
						columnIndices
					);
					const end = new Date().getTime();
					console.log(`Fetching data took ${end - start}ms`);
					return data;
				}
			);

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
		await this._dataExplorerClientInstance.setSortColumns(columnSorts.map(columnSort => (
			{
				column_index: columnSort.columnIndex,
				ascending: columnSort.ascending
			} satisfies ColumnSortKey
		)));

		// Refetch data.
		this.resetCache();
		await this.doFetchData();
	}

	fetchData() {
		this.doFetchData().then(() => {

		}).catch(x => {
			console.log(x);
		});
	}

	/**
	 * Gets a column.
	 * @param columnIndex The column index.
	 * @returns The column.
	 */
	column(columnIndex: number) {
		if (!this._tableSchema) {
			return undefined;
		}

		if (columnIndex < 0 || columnIndex > this._tableSchema.columns.length) {
			return undefined;
		}

		return new PositronDataExplorerColumn(this._tableSchema.columns[columnIndex]);
	}

	/**
	 * Gets a row header.
	 * @param rowIndex The row index.
	 * @returns The row label, or, undefined.
	 */
	rowHeader(rowIndex: number) {
		// If the table schema hasn't been loaded, return undefined.
		if (!this._tableSchema) {
			return undefined;
		}

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

		// If there are no row labels, return the TableDataRowHeader.
		if (!this._lastFetchResult.data.row_labels) {
			return (
				<TableDataRowHeader value={`${rowIndex + 1}`} />
			);
		}

		// Calculate the cached row index.
		const cachedRowIndex = rowIndex - this._lastFetchResult.rowStartIndex;

		// Return the TableDataRowHeader.
		return (
			<TableDataRowHeader value={this._lastFetchResult.data.row_labels[0][cachedRowIndex]} />
		);
	}

	/**
	 * Gets a data cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell value.
	 */
	cell(columnIndex: number, rowIndex: number): JSX.Element | undefined {
		// If the table schema hasn't been loaded, return undefined.
		if (!this._tableSchema) {
			return undefined;
		}

		// If there isn't any cached data, return undefined.
		if (!this._lastFetchResult) {
			return undefined;
		}

		// If the column schema hasn't been loaded, return undefined.
		if (columnIndex >= this._tableSchema.columns.length) {
			return undefined;
		}

		// Get the column schema.
		const columnSchema = this._tableSchema.columns[columnIndex];

		// If the cell isn't cached, return undefined.
		if (columnIndex < this._lastFetchResult.columnStartIndex ||
			columnIndex >= this._lastFetchResult.columnEndIndex ||
			rowIndex < this._lastFetchResult.rowStartIndex ||
			rowIndex >= this._lastFetchResult.rowEndIndex
		) {
			return undefined;
		}

		// Calculate the cache indices.
		const cachedColumnIndex = columnIndex - this._lastFetchResult.columnStartIndex;
		const cachedRowIndex = rowIndex - this._lastFetchResult.rowStartIndex;

		// Get the cached value.
		const value = this._lastFetchResult.data.columns[cachedColumnIndex][cachedRowIndex];

		// Return the TableDataCell.
		return (
			<TableDataCell
				column={new PositronDataExplorerColumn(columnSchema)}
				value={value}
			/>
		);
	}

	//#region Private Methods

	private resetCache() {
		// Clear the data cache
		this._cache?.clear();
		this._lastFetchResult = undefined;
	}

	private needToFetch(range: FetchRange) {
		if (!this._lastFetchResult) {
			return true;
		} else {
			return !PositronDataExplorerCache.rangeIncludes(range, this._lastFetchResult);
		}
	}

	private async doFetchData(): Promise<void> {
		// If the table schema hasn't loaded, we cannot fetch data.
		if (!this._tableSchema) {
			return;
		}

		// Calculate the fetch range.
		const fetchRange: FetchRange = {
			rowStartIndex: this.firstRowIndex,
			rowEndIndex: this.firstRowIndex + this.visibleRows,
			columnStartIndex: this.firstColumnIndex,

			// TODO: column edge detection can cause visibleColumns to be one less than what the
			// user actually sees, so we fudge this for now
			columnEndIndex: this.firstColumnIndex + this.visibleColumns + 1
		};

		if (this.needToFetch(fetchRange)) {
			this._lastFetchResult = await this._cache?.fetch(fetchRange);
		}

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	//#endregion Private Methods
}
