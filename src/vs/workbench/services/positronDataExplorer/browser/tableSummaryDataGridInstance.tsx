/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies.
import { DataGridInstance } from 'vs/base/browser/ui/positronDataGrid/classes/dataGridInstance';
import { DataExplorerCache } from 'vs/workbench/services/positronDataExplorer/common/dataExplorerCache';
import { ColumnSchemaTypeDisplay } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { ColumnSummaryCell } from 'vs/workbench/services/positronDataExplorer/browser/components/columnSummaryCell';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';

/**
 * Constants.
 */
const SUMMARY_HEIGHT = 34;
const PROFILE_LINE_HEIGHT = 20;

/**
 * TableSummaryDataGridInstance class.
 */
export class TableSummaryDataGridInstance extends DataGridInstance {
	//#region Private Properties

	/**
	 * Gets the data explorer client instance.
	 */
	private readonly _dataExplorerClientInstance: DataExplorerClientInstance;

	/**
	 * Gets the data explorer cache.
	 */
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

		// Allocate and initialize the DataExplorerCache.
		this._dataExplorerCache = new DataExplorerCache(dataExplorerClientInstance);
		this._dataExplorerCache.onDidUpdateCache(() => this._onDidUpdateEmitter.fire());

		// Add the onDidSchemaUpdate event handler.
		this._dataExplorerClientInstance.onDidSchemaUpdate(async () => {
			this.setScreenPosition(0, 0);
			this._expandedColumns.clear();
			this.fetchData();
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
	 * Fetches data.
	 */
	override fetchData() {
		this._dataExplorerCache.updateCache({
			firstColumnIndex: this.firstRowIndex,
			visibleColumns: this.screenRows
		});
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
		// If the column isn't expanded, return the summary height.
		if (!this.isColumnExpanded(rowIndex)) {
			return SUMMARY_HEIGHT;
		}

		// Get the column schema. If it hasn't been loaded yet, return the summary height.
		const columnSchema = this._dataExplorerCache.getColumnSchema(rowIndex);
		if (!columnSchema) {
			return SUMMARY_HEIGHT;
		}

		/**
		 * Returns the row height with the specified number of lines.
		 * @param profileLines
		 * @returns
		 */
		const rowHeight = (profileLines: number) => {
			if (profileLines === 0) {
				return SUMMARY_HEIGHT;
			} else {
				return SUMMARY_HEIGHT + (profileLines * PROFILE_LINE_HEIGHT) + 10;
			}
		};

		// Return the row height.
		switch (columnSchema.type_display) {
			case ColumnSchemaTypeDisplay.Number:
				return rowHeight(6);

			case ColumnSchemaTypeDisplay.Boolean:
				return rowHeight(3);

			case ColumnSchemaTypeDisplay.String:
				return rowHeight(3);

			case ColumnSchemaTypeDisplay.Date:
				return rowHeight(7);

			case ColumnSchemaTypeDisplay.Datetime:
				return rowHeight(7);

			case ColumnSchemaTypeDisplay.Time:
				return rowHeight(7);

			case ColumnSchemaTypeDisplay.Array:
				return rowHeight(2);

			case ColumnSchemaTypeDisplay.Struct:
				return rowHeight(2);

			case ColumnSchemaTypeDisplay.Unknown:
				return rowHeight(2);

			// This shouldn't ever happen.
			default:
				return rowHeight(0);
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
	 * Gets a cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell.
	 */
	cell(columnIndex: number, rowIndex: number): JSX.Element | undefined {
		// Column index must be 0.
		if (columnIndex !== 0) {
			return undefined;
		}

		// Get the column schema.
		const columnSchema = this._dataExplorerCache.getColumnSchema(rowIndex);
		if (!columnSchema) {
			return undefined;
		}

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
			this.scrollToRow(columnIndex);
		}

		this._onDidUpdateEmitter.fire();
	}

	//#endregion Private Methods
}
