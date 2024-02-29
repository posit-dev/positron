/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies.
import { IColumnSortKey } from 'vs/base/browser/ui/positronDataGrid/interfaces/columnSortKey';
import { DataGridInstance } from 'vs/base/browser/ui/positronDataGrid/classes/dataGridInstance';
import { DataExplorerCache } from 'vs/workbench/services/positronDataExplorer/common/dataExplorerCache';
import { TableDataCell } from 'vs/workbench/services/positronDataExplorer/browser/components/tableDataCell';
import { TableDataRowHeader } from 'vs/workbench/services/positronDataExplorer/browser/components/tableDataRowHeader';
import { ColumnSortKey, SchemaUpdateEvent } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { PositronDataExplorerColumn } from 'vs/workbench/services/positronDataExplorer/browser/positronDataExplorerColumn';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';

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
			rowResize: true,
			minimumRowHeight: 24,
			horizontalScrollbar: true,
			verticalScrollbar: true,
			scrollbarWidth: 14,
			cellBorders: true,
			cursor: true,
			cursorOffset: 0.5,
		});

		// Setup the data explorer client instance.
		this._dataExplorerClientInstance = dataExplorerClientInstance;

		// Allocate and initialize the DataExplorerCache.
		this._dataExplorerCache = new DataExplorerCache(dataExplorerClientInstance);
		this._dataExplorerCache.onDidUpdateCache(() => this._onDidUpdateEmitter.fire());

		this._dataExplorerClientInstance.onDidSchemaUpdate(async (e: SchemaUpdateEvent) => {
			this.softReset();
			this.fetchData();
		});
		this._dataExplorerClientInstance.onDidDataUpdate(async () => {
			this.fetchData();
		});
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
			} satisfies ColumnSortKey
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
		this._dataExplorerCache.updateCache(
			this.firstColumnIndex,
			this.screenColumns,
			this.firstRowIndex,
			this.screenRows
		);
	}

	/**
	 * Gets a column.
	 * @param columnIndex The column index.
	 * @returns The column.
	 */
	column(columnIndex: number) {
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

		// Get the cell.
		const cell = this._dataExplorerCache.getCellValue(columnIndex, rowIndex);
		if (!cell) {
			return undefined;
		}

		// Return the TableDataCell.
		return (
			<TableDataCell column={column} value={cell} />
		);
	}

	//#endregion DataGridInstance Methods
}
