/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies.
import { IColumnSortKey } from 'vs/base/browser/ui/positronDataGrid/interfaces/columnSortKey';
import { DataGridInstance } from 'vs/base/browser/ui/positronDataGrid/classes/dataGridInstance';
import { DataExplorerCache } from 'vs/workbench/services/positronDataExplorer/common/dataExplorerCache';
import { ColumnSchemaTypeDisplay } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { ColumnSummaryCell } from 'vs/workbench/services/positronDataExplorer/browser/components/columnSummaryCell';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';

/**
 * Constants.
 */
const SUMMARY_HEIGHT = 34;
const EXTENDED_INFO_LINE_HEIGHT = 20;

/**
 * TableSummaryDataGridInstance class.
 */
export class TableSummaryDataGridInstance extends DataGridInstance {
	//#region Private Properties

	/**
	 * Gets the data explorer client instance.
	 */
	private readonly _dataExplorerClientInstance: DataExplorerClientInstance;

	// private _tableSchema?: TableSchema;

	// private _schemaCache: TableSchemaCache;
	// private _lastFetchedSchema?: FetchedSchema;

	private readonly _dataExplorerCache: DataExplorerCache;

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
			defaultRowHeight: SUMMARY_HEIGHT,

			columnResize: false,
			rowResize: false,

			horizontalScrollbar: false,
			verticalScrollbar: true,
			scrollbarWidth: 14,

			cellBorders: false,

			cursor: false,

			selection: false
		});

		// Set the data explorer client instance.
		this._dataExplorerClientInstance = dataExplorerClientInstance;

		this._dataExplorerCache = new DataExplorerCache(this._dataExplorerClientInstance);

		this._dataExplorerCache.onDidUpdate(() => {
			this._onDidUpdateEmitter.fire();
		});
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
		return this._dataExplorerCache.columns;
	}

	//#endregion DataGridInstance Properties

	//#region DataGridInstance Methods

	/**
	 *
	 */
	initialize() {



		// this._dataExplorerClientInstance.getSchema(0, 1000).then(tableSchema => {

		// 	console.log(`++++++++++ Schema returned with ${tableSchema.columns.length} columns`);

		// 	this._tableSchema = tableSchema;

		// 	this._onDidUpdateEmitter.fire();

		// }).catch(x => {

		// });
	}

	/**
	 * Sorts the data.
	 * @returns A Promise<void> that resolves when the data is sorted.
	 */
	async sortData(columnSorts: IColumnSortKey[]): Promise<void> {
	}

	/**
	 * Fetches data.
	 */
	fetchData() {
		this._dataExplorerCache.updateCache(this.firstRowIndex, this.screenRows);
	}

	/**
	 * Gets the the width of a column.
	 * @param columnIndex The column index.
	 */
	override getColumnWidth(columnIndex: number): number {
		return this.layoutWidth;
	}

	/**
	 * Gets the the height of a row.
	 * @param rowIndex The row index.
	 */
	override getRowHeight(rowIndex: number): number {
		if (!this.isColumnExpanded(rowIndex)) {
			return SUMMARY_HEIGHT;
		}

		// Get the column schema.
		const columnSchema = this._dataExplorerCache.getColumn(rowIndex);
		if (!columnSchema) {
			return SUMMARY_HEIGHT;
		}

		const rowHeightWithExtendedInfo = (lines: number) => {
			if (lines === 0) {
				return SUMMARY_HEIGHT;
			} else {
				return SUMMARY_HEIGHT + (lines * EXTENDED_INFO_LINE_HEIGHT) + 10;
			}
		};

		switch (columnSchema.type_display) {
			case ColumnSchemaTypeDisplay.Number:
				return rowHeightWithExtendedInfo(6);

			case ColumnSchemaTypeDisplay.Boolean:
				return rowHeightWithExtendedInfo(3);

			case ColumnSchemaTypeDisplay.String:
				return rowHeightWithExtendedInfo(3);

			case ColumnSchemaTypeDisplay.Date:
				return rowHeightWithExtendedInfo(7);

			case ColumnSchemaTypeDisplay.Datetime:
				return rowHeightWithExtendedInfo(7);

			case ColumnSchemaTypeDisplay.Time:
				return rowHeightWithExtendedInfo(7);

			case ColumnSchemaTypeDisplay.Array:
				return rowHeightWithExtendedInfo(2);

			case ColumnSchemaTypeDisplay.Struct:
				return rowHeightWithExtendedInfo(2);

			case ColumnSchemaTypeDisplay.Unknown:
				return rowHeightWithExtendedInfo(2);

			// This shouldn't ever happen.
			default:
				return rowHeightWithExtendedInfo(0);
		}
	}

	/**
	 * Gets a column.
	 * @param columnIndex The column index.
	 * @returns The column.
	 */
	column(columnIndex: number) {
		return undefined;
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

		const d = this._dataExplorerCache.getColumn(rowIndex);

		if (!d) {
			return undefined;
		}

		// Return the ColumnSummaryCell.
		return (
			<ColumnSummaryCell
				instance={this}
				columnSchema={d}
				columnIndex={rowIndex}
			/>
		);


		// // If the table schema hasn't been loaded, return undefined.
		// if (!this._tableSchema) {
		// 	return undefined;
		// }

		// // If the column schema hasn't been loaded, return undefined.
		// if (rowIndex >= this._tableSchema.columns.length) {
		// 	return undefined;
		// }

		// // Get the column schema.
		// const columnSchema = this._tableSchema.columns[rowIndex];

		// // Return the ColumnSummaryCell.
		// return (
		// 	<ColumnSummaryCell
		// 		instance={this}
		// 		columnSchema={columnSchema}
		// 		columnIndex={rowIndex}
		// 	/>
		// );
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
			this.scrollToRow(columnIndex);
		}

		this._onDidUpdateEmitter.fire();
	}

	//#endregion Public Methods

	//#region Private Methods

	// /**
	//  * Fetches data.
	//  */
	// private async doFetchData(): Promise<void> {


	// 	const start = new Date();
	// 	const foo = await this._dataExplorerClientInstance.getSchema(0, 0);
	// 	const end = new Date();

	// 	console.log(`Loading ${foo.columns.length} took ${end.getTime() - start.getTime()}ms`);


	// 	const schemaFetchRange: SchemaFetchRange = {
	// 		startIndex: this.firstRowIndex,
	// 		endIndex: this.firstRowIndex + this.visibleRows + 1
	// 	};

	// 	if (!this._lastFetchedSchema ||
	// 		!this._schemaCache?.rangeIncludes(schemaFetchRange, this._lastFetchedSchema)) {
	// 		this._lastFetchedSchema = await this._schemaCache?.fetch(schemaFetchRange);
	// 	}

	// 	// Fire the onDidUpdate event.
	// 	this._onDidUpdateEmitter.fire();
	// }

	//#endregion Private Methods
}
