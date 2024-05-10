/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies.
import { IColumnSortKey } from 'vs/workbench/browser/positronDataGrid/interfaces/columnSortKey';
import { DataExplorerCache } from 'vs/workbench/services/positronDataExplorer/common/dataExplorerCache';
import { TableDataCell } from 'vs/workbench/services/positronDataExplorer/browser/components/tableDataCell';
import { TableDataRowHeader } from 'vs/workbench/services/positronDataExplorer/browser/components/tableDataRowHeader';
import { PositronDataExplorerColumn } from 'vs/workbench/services/positronDataExplorer/browser/positronDataExplorerColumn';
import { ColumnSortKeyDescriptor, DataGridInstance } from 'vs/workbench/browser/positronDataGrid/classes/dataGridInstance';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { BackendState, RowFilter, SchemaUpdateEvent } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

/**
 * TableDataDataGridInstance class.
 */
export class TableDataDataGridInstance extends DataGridInstance {
	//#region Private Properties

	/**
	 * Gets the data explorer client instance.
	 */
	private readonly _dataExplorerClientInstance: DataExplorerClientInstance;

	/**
	 * Gets the data explorer cache.
	 */
	private readonly _dataExplorerCache: DataExplorerCache;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param dataExplorerClientInstance The DataExplorerClientInstance.
	 */
	constructor(dataExplorerClientInstance: DataExplorerClientInstance,
		dataCache: DataExplorerCache
	) {
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
			automaticLayout: true,
			cellBorders: true,
			internalCursor: true,
			cursorOffset: 0.5,
		});

		// Setup the data explorer client instance.
		this._dataExplorerClientInstance = dataExplorerClientInstance;

		// Set the shared data cache
		this._dataExplorerCache = dataCache;

		// Add the onDidUpdateCache event handler.
		this._register(this._dataExplorerCache.onDidUpdateCache(() =>
			this._onDidUpdateEmitter.fire()
		));

		// Add the onDidSchemaUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidSchemaUpdate(async (e: SchemaUpdateEvent) => {
			this.softReset();
			this.fetchData();
		}));

		// Add the onDidDataUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidDataUpdate(async () => {
			this.fetchData();
		}));

		// Add the onDidUpdateBackendState event handler.
		this._register(this._dataExplorerClientInstance.onDidUpdateBackendState(
			async (state: BackendState) => {
				// Clear column sort keys.
				this._columnSortKeys.clear();
				state.sort_keys.forEach((key, sortIndex) => {
					this._columnSortKeys.set(key.column_index,
						new ColumnSortKeyDescriptor(sortIndex, key.column_index, key.ascending)
					);
				});
				this._onDidUpdateEmitter.fire();
			}
		));
	}

	//#endregion Constructor

	//#region DataGridInstance Properties

	/**
	 * Gets the number of columns.
	 */
	get columns() {
		return this._dataExplorerCache.columns;
	}

	/**
	 * Gets the number of rows.
	 */
	get rows() {
		return this._dataExplorerCache.rows;
	}

	//#endregion DataGridInstance Properties

	//#region DataGridInstance Methods

	/**
	 * Sorts the data.
	 * @returns A Promise<void> that resolves when the data is sorted.
	 */
	override async sortData(columnSorts: IColumnSortKey[]): Promise<void> {
		// Set the sort columns.
		await this._dataExplorerClientInstance.setSortColumns(columnSorts.map(columnSort => (
			{
				column_index: columnSort.columnIndex,
				ascending: columnSort.ascending
			}
		)));

		// Clear the data cache and fetch new data.
		this._dataExplorerCache.invalidateDataCache();
		this.fetchData();
	}

	/**
	 * Fetches data.
	 */
	override fetchData() {
		// Update the cache.
		this._dataExplorerCache.updateCache({
			firstColumnIndex: this.firstColumnIndex,
			visibleColumns: this.screenColumns,
			firstRowIndex: this.firstRowIndex,
			visibleRows: this.screenRows
		});
	}

	/**
	 * Gets a column.
	 * @param columnIndex The column index.
	 * @returns The column.
	 */
	override column(columnIndex: number) {
		// Get the column schema.
		const columnSchema = this._dataExplorerCache.getColumnSchema(columnIndex);
		if (!columnSchema) {
			return undefined;
		}

		// Return the column.
		return new PositronDataExplorerColumn(columnSchema);
	}

	/**
	 * Gets a row header.
	 * @param rowIndex The row index.
	 * @returns The row label, or, undefined.
	 */
	override rowHeader(rowIndex: number) {
		return (
			<TableDataRowHeader value={this._dataExplorerCache.getRowLabel(rowIndex)} />
		);
	}

	/**
	 * Gets a data cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell value.
	 */
	cell(columnIndex: number, rowIndex: number): JSX.Element | undefined {
		// Get the column.
		const column = this.column(columnIndex);
		if (!column) {
			return undefined;
		}

		// Get the cell value.
		const cellValue = this._dataExplorerCache.getCellValue(columnIndex, rowIndex);
		if (!cellValue) {
			return undefined;
		}

		// Return the TableDataCell.
		return (
			<TableDataCell column={column} cellValue={cellValue} />
		);
	}

	//#endregion DataGridInstance Methods

	//#region Public Methods

	/**
	 * Sets row filters.
	 * @param rowFilters The row filters.
	 * @returns A Promise<FilterResult> that resolves when the operation is complete.
	 */
	async setRowFilters(filters: Array<RowFilter>): Promise<void> {
		// Set the row filters.
		await this._dataExplorerClientInstance.setRowFilters(filters);

		// Synchronize the backend state.
		await this._dataExplorerClientInstance.updateBackendState();

		// Reload the data grid.
		this._dataExplorerCache.invalidateDataCache();
		this.softReset();
		this.fetchData();
	}

	//#endregion Public Methods
}
