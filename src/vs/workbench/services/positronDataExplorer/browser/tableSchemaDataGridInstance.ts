/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IColumnSortKey } from 'vs/base/browser/ui/positronDataGrid/interfaces/columnSortKey';
import { DataGridInstance } from 'vs/base/browser/ui/positronDataGrid/classes/dataGridInstance';
import { TableSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { PositronDataExplorerColumn } from 'vs/workbench/services/positronDataExplorer/browser/positronDataExplorerColumn';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';

/**
 * TableSchemaDataGridInstance class.
 */
export class TableSchemaDataGridInstance extends DataGridInstance {
	//#region Private Properties

	/**
	 * Gets the data explorer client instance.
	 */
	private readonly _dataExplorerClientInstance: DataExplorerClientInstance;

	private _tableSchema?: TableSchema;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param dataExplorerClientInstance The DataExplorerClientInstance.
	 */
	constructor(dataExplorerClientInstance: DataExplorerClientInstance) {
		// Call the base class's constructor.
		super({
			columnHeadersHeight: 0,
			rowHeadersWidth: 0,
			minimumColumnWidth: 100,
			defaultColumnWidth: 200,
			minimumRowHeight: 24,
			defaultRowHeight: 24,
			scrollbarWidth: 14
		});

		// Set the data explorer client instance.
		this._dataExplorerClientInstance = dataExplorerClientInstance;
	}

	//#endregion Constructor

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

	/**
	 *
	 */
	initialize() {
		this._dataExplorerClientInstance.getSchema().then(tableSchema => {

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
	 * Gets a row label.
	 * @param rowIndex The row index.
	 * @returns The row label.
	 */
	rowLabel(rowIndex: number) {
		return undefined;
	}

	/**
	 * Gets a cell value.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell value.
	 */
	cell(columnIndex: number, rowIndex: number): string | undefined {
		return undefined;
	}

	//#region Private Methods

	//#endregion Private Methods
}
