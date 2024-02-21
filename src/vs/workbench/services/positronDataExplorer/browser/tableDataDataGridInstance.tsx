/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies.
import { IColumnSortKey } from 'vs/base/browser/ui/positronDataGrid/interfaces/columnSortKey';
import { DataGridInstance } from 'vs/base/browser/ui/positronDataGrid/classes/dataGridInstance';
import { TableDataCell } from 'vs/workbench/services/positronDataExplorer/browser/components/tableDataCell';
import { TableDataRowHeader } from 'vs/workbench/services/positronDataExplorer/browser/components/tableDataRowHeader';
import { PositronDataExplorerColumn } from 'vs/workbench/services/positronDataExplorer/browser/positronDataExplorerColumn';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { ColumnSortKey } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import {
	DataFetchRange,
	FetchedData,
	FetchedSchema,
	TableDataCache,
	TableSchemaCache,
	SchemaFetchRange
} from 'vs/workbench/services/positronDataExplorer/common/positronDataExplorerCache';

/**
 * TableDataDataGridInstance class.
 */
export class TableDataDataGridInstance extends DataGridInstance {
	//#region Private Properties

	/**
	 * Gets the data explorer client instance.
	 */
	private readonly _dataExplorerClientInstance: DataExplorerClientInstance;

	private _dataCache?: TableDataCache;
	private _lastFetchedData?: FetchedData;

	private _schemaCache?: TableSchemaCache;
	private _lastFetchedSchema?: FetchedSchema;

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
		return this._lastFetchedSchema ? this._lastFetchedSchema.schema.total_num_columns : 0;
	}

	/**
	 * Gets the number of rows.
	 */
	get rows() {
		return this._lastFetchedSchema ? this._lastFetchedSchema.schema.num_rows : 0;
	}

	/**
	 *
	 */
	initialize() {
		this._schemaCache = new TableSchemaCache(
			async (req: SchemaFetchRange) => {
				return this._dataExplorerClientInstance.getSchema(req.startIndex,
					req.endIndex - req.startIndex);
			}
		);
		this._schemaCache.initialize().then(async (_) => {
			this._lastFetchedSchema = await this._schemaCache?.fetch({ startIndex: 0, endIndex: 1000 });

			this._dataCache = new TableDataCache(
				this._schemaCache?.tableShape!,
				async (req: DataFetchRange) => {
					// Build the column indices to fetch.
					const columnIndices: number[] = [];
					for (let i = req.columnStartIndex; i < req.columnEndIndex; i++) {
						columnIndices.push(i);
					}
					return this._dataExplorerClientInstance.getDataValues(
						req.rowStartIndex,
						req.rowEndIndex - req.rowStartIndex,
						columnIndices
					);
				});

			// Fetch data.
			this.fetchData();
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
		if (!this._lastFetchedSchema) {
			return undefined;
		}

		if (columnIndex < this._lastFetchedSchema.startIndex ||
			columnIndex >= this._lastFetchedSchema.endIndex) {
			return undefined;
		}

		const cachedSchemaIndex = columnIndex - this._lastFetchedSchema.startIndex;

		return new PositronDataExplorerColumn(this._lastFetchedSchema.schema.columns[cachedSchemaIndex]);
	}

	/**
	 * Gets a row header.
	 * @param rowIndex The row index.
	 * @returns The row label, or, undefined.
	 */
	rowHeader(rowIndex: number) {
		// If the table schema hasn't been loaded, return undefined.
		if (!this._lastFetchedSchema) {
			return undefined;
		}

		// If there isn't any cached data, return undefined.
		if (!this._lastFetchedData) {
			return undefined;
		}

		// If the row isn't cached, return undefined.
		if (rowIndex < this._lastFetchedData.rowStartIndex ||
			rowIndex > this._lastFetchedData.rowEndIndex
		) {
			return undefined;
		}

		// If there are no row labels, return the TableDataRowHeader.
		if (!this._lastFetchedData.data.row_labels) {
			return (
				<TableDataRowHeader value={`${rowIndex + 1}`} />
			);
		}

		// Calculate the cached row index.
		const cachedRowIndex = rowIndex - this._lastFetchedData.rowStartIndex;

		// Return the TableDataRowHeader.
		return (
			<TableDataRowHeader value={this._lastFetchedData.data.row_labels[0][cachedRowIndex]} />
		);
	}

	/**
	 * Gets a data cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell value.
	 */
	cell(columnIndex: number, rowIndex: number): JSX.Element | undefined {
		// We need the data and schema to render the cell
		if (!this._lastFetchedData || !this._lastFetchedSchema) {
			return undefined;
		}

		// Check that we have the schema and data values for this cell
		if (columnIndex < this._lastFetchedSchema.startIndex ||
			columnIndex >= this._lastFetchedSchema.endIndex ||
			columnIndex < this._lastFetchedData.columnStartIndex ||
			columnIndex >= this._lastFetchedData.columnEndIndex ||
			rowIndex < this._lastFetchedData.rowStartIndex ||
			rowIndex >= this._lastFetchedData.rowEndIndex) {
			return undefined;
		}

		// Calculate the cache indices.
		const cachedSchemaIndex = columnIndex - this._lastFetchedSchema.startIndex;
		const cachedColumnIndex = columnIndex - this._lastFetchedData.columnStartIndex;
		const cachedRowIndex = rowIndex - this._lastFetchedData.rowStartIndex;

		// Get the column schema.
		const columnSchema = this._lastFetchedSchema.schema.columns[cachedSchemaIndex];

		// Get the cached value.
		const value = this._lastFetchedData.data.columns[cachedColumnIndex][cachedRowIndex];

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
		this._dataCache?.clear();
		this._lastFetchedData = undefined;
	}

	private async doFetchData(): Promise<void> {
		const schemaRange: SchemaFetchRange = {
			startIndex: this.firstColumnIndex,
			endIndex: this.firstColumnIndex + this.visibleColumns + 1
		};

		if (!this._lastFetchedSchema ||
			!this._schemaCache?.rangeIncludes(schemaRange, this._lastFetchedSchema)) {
			this._lastFetchedSchema = await this._schemaCache?.fetch(schemaRange);
		}

		const dataRange: DataFetchRange = {
			rowStartIndex: this.firstRowIndex,
			rowEndIndex: this.firstRowIndex + this.visibleRows,
			columnStartIndex: this.firstColumnIndex,

			// TODO: column edge detection can cause visibleColumns to be one less than what the
			// user actually sees, so we fudge this for now
			columnEndIndex: this.firstColumnIndex + this.visibleColumns + 1
		};

		if (!this._lastFetchedData ||
			!this._dataCache?.rangeIncludes(dataRange, this._lastFetchedData)) {
			this._lastFetchedData = await this._dataCache?.fetch(dataRange);
		}

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
	}

	//#endregion Private Methods
}
