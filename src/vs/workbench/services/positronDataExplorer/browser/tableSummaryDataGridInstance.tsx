/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies.
import { IColumnSortKey } from 'vs/base/browser/ui/positronDataGrid/interfaces/columnSortKey';
import { DataGridInstance } from 'vs/base/browser/ui/positronDataGrid/classes/dataGridInstance';
import { TableSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { ColumnSummaryCell } from 'vs/workbench/services/positronDataExplorer/browser/components/columnSummaryCell';
import { PositronDataExplorerColumn } from 'vs/workbench/services/positronDataExplorer/browser/positronDataExplorerColumn';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';

/**
 * TableSummaryDataGridInstance class.
 */
export class TableSummaryDataGridInstance extends DataGridInstance {
	//#region Private Properties

	/**
	 * Gets the data explorer client instance.
	 */
	private readonly _dataExplorerClientInstance: DataExplorerClientInstance;

	private _tableSchema?: TableSchema;

	/**
	 * Gets the expanded columns set.
	 */
	private readonly _expandedColumns = new Set<number>();

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param dataExplorerClientInstance The DataExplorerClientInstance.
	 */
	constructor(dataExplorerClientInstance: DataExplorerClientInstance) {
		// Call the base class's constructor.
		super({
			columnHeaders: false,

			rowHeaders: false,

			defaultColumnWidth: 200,
			defaultRowHeight: 34,

			columnResize: false,
			rowResize: false,

			horizontalScrollbar: false,
			verticalScrollbar: true,
			scrollbarWidth: 8,

			cellBorders: false,
			cursorOffset: 1.5,

			selection: false
		});

		// Set the data explorer client instance.
		this._dataExplorerClientInstance = dataExplorerClientInstance;
	}

	//#endregion Constructor

	//#region DataGridInstance Properties

	/**
	 * Gets the number of columns.
	 */
	get columns() {
		return 1;
	}

	/**
	 * Gets the number of rows.
	 */
	get rows() {
		return this._tableSchema ? this._tableSchema.total_num_columns : 0;
	}

	//#endregion DataGridInstance Properties

	//#region DataGridInstance Methods

	/**
	 *
	 */
	initialize() {
		this._dataExplorerClientInstance.getSchema(0, 1000).then(tableSchema => {

			console.log(`++++++++++ Schema returned with ${tableSchema.columns.length} columns`);

			this._tableSchema = tableSchema;

			this._onDidUpdateEmitter.fire();

		}).catch(x => {

		});
	}

	/**
	 * Sorts the data.
	 * @returns A Promise<void> that resolves when the data is sorted.
	 */
	async sortData(columnSorts: IColumnSortKey[]): Promise<void> {
	}

	fetchData() {
	}

	/**
	 * Gets the the width of a column.
	 * @param columnIndex The column index.
	 */
	override getColumnWidth(columnIndex: number): number {
		return this.layoutWidth;
	}

	/**
	 * Gets a column.
	 * @param columnIndex The column index.
	 * @returns The column.
	 */
	column(columnIndex: number) {
		// If the table schema hasn't been loaded, return undefined.
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
	 * @returns The row header, or, undefined.
	 */
	rowHeader(rowIndex: number) {
		return undefined;
	}

	/**
	 * Gets a data cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell value.
	 */
	cell(columnIndex: number, rowIndex: number): JSX.Element | undefined {
		// Column index must be 0.
		if (columnIndex !== 0) {
			return undefined;
		}

		// If the table schema hasn't been loaded, return undefined.
		if (!this._tableSchema) {
			return undefined;
		}

		// If the column schema hasn't been loaded, return undefined.
		if (rowIndex >= this._tableSchema.columns.length) {
			return undefined;
		}

		// Get the column schema.
		const columnSchema = this._tableSchema.columns[rowIndex];

		// Return the ColumnSummaryCell.
		return (
			<ColumnSummaryCell
				instance={this}
				columnSchema={columnSchema}
				columnIndex={rowIndex}
			/>
		);
	}

	//#region DataGridInstance Methods

	//#region Public Methods

	isColumnExpanded(columnIndex: number) {
		return this._expandedColumns.has(columnIndex);
	}

	toggleExpandedColumn(columnIndex: number) {
		if (this._expandedColumns.has(columnIndex)) {
			this._expandedColumns.delete(columnIndex);
		} else {
			this._expandedColumns.add(columnIndex);
		}

		this._onDidUpdateEmitter.fire();
	}

	//#endregion Public Methods

	//#region Private Methods

	//#endregion Private Methods
}
