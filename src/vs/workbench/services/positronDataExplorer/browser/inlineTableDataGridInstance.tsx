/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { JSX } from 'react';

// Other dependencies.
import { Emitter } from '../../../../base/common/event.js';
import { DataGridInstance, ColumnSortKeyDescriptor } from '../../../browser/positronDataGrid/classes/dataGridInstance.js';
import { DataExplorerClientInstance } from '../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { InvalidateCacheFlags, TableDataCache } from '../common/tableDataCache.js';
import { PositronDataExplorerColumn } from './positronDataExplorerColumn.js';
import { TableDataCell } from './components/tableDataCell.js';
import { TableDataRowHeader } from './components/tableDataRowHeader.js';
import { BackendState } from '../../languageRuntime/common/positronDataExplorerComm.js';
import { IColumnSortKey } from '../../../browser/positronDataGrid/interfaces/columnSortKey.js';

/**
 * Constants.
 */
const OVERSCAN_FACTOR = 3;

/**
 * InlineTableDataGridInstance class.
 *
 * A simplified data grid instance for displaying dataframes inline in notebook cells.
 * This is a stripped-down version of TableDataDataGridInstance with:
 * - Sorting enabled via column headers
 * - No column/row resize
 * - No column/row pinning
 * - No context menus
 * - No filtering (filtering is handled by the full data explorer)
 */
export class InlineTableDataGridInstance extends DataGridInstance {
	//#region Private Properties

	/**
	 * The onDidClose event emitter.
	 */
	private readonly _onDidCloseEmitter = this._register(new Emitter<void>());

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param _dataExplorerClientInstance The data explorer client instance.
	 * @param _tableDataCache The table data cache.
	 */
	constructor(
		private readonly _dataExplorerClientInstance: DataExplorerClientInstance,
		private readonly _tableDataCache: TableDataCache,
	) {
		// Call the base class's constructor with simplified options
		super({
			columnHeaders: true,
			columnHeadersHeight: 28,
			rowHeaders: true,
			rowHeadersWidth: 50,
			rowHeadersResize: false,
			defaultColumnWidth: 150,
			defaultRowHeight: 22,
			columnResize: false,
			rowResize: false,
			columnPinning: false,
			rowPinning: false,
			horizontalScrollbar: true,
			verticalScrollbar: true,
			scrollbarThickness: 10,
			scrollbarOverscroll: 0,
			useEditorFont: true,
			automaticLayout: true,
			cellBorders: true,
			horizontalCellPadding: 5,
			internalCursor: true,
			cursorOffset: 0.5,
			selection: false,
		});

		/**
		 * Updates the layout entries.
		 * @param state The backend state, if known; otherwise, undefined.
		 */
		const updateLayoutEntries = async (state?: BackendState) => {
			// Get the backend state, if was not provided.
			if (!state) {
				state = await this._dataExplorerClientInstance.getBackendState();
			}

			// Set the layout entries without calculating column widths
			// (simplified from full data explorer)
			this._columnLayoutManager.setEntries(state.table_shape.num_columns);
			this._rowLayoutManager.setEntries(state.table_shape.num_rows);

			// Adjust scroll offsets if needed
			if (state.table_shape.num_rows === 0) {
				this._verticalScrollOffset = 0;
				this._horizontalScrollOffset = 0;
				this.softReset();
				this.fireOnDidUpdateEvent();
			} else {
				if (!this.firstRow) {
					this._verticalScrollOffset = 0;
				} else if (this._verticalScrollOffset > this.maximumVerticalScrollOffset) {
					this._verticalScrollOffset = this.maximumVerticalScrollOffset;
				}

				if (!this.firstColumn) {
					this._horizontalScrollOffset = 0;
				} else if (this._horizontalScrollOffset > this.maximumHorizontalScrollOffset) {
					this._horizontalScrollOffset = this.maximumHorizontalScrollOffset;
				}
			}
		};

		// Add the data explorer client onDidSchemaUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidSchemaUpdate(async () => {
			await updateLayoutEntries();
			this.softReset();
			await this.fetchData(InvalidateCacheFlags.All);
		}));

		// Add the data explorer client onDidDataUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidDataUpdate(async () => {
			await updateLayoutEntries();
			await this.fetchData(InvalidateCacheFlags.Data);
		}));

		// Add the data explorer client onDidUpdateBackendState event handler.
		this._register(this._dataExplorerClientInstance.onDidUpdateBackendState(async state => {
			await updateLayoutEntries(state);

			// Clear column sort keys.
			this._columnSortKeys.clear();

			// Update the column sort keys from the state.
			state.sort_keys.forEach((key, sortIndex) => {
				this._columnSortKeys.set(
					key.column_index,
					new ColumnSortKeyDescriptor(sortIndex, key.column_index, key.ascending)
				);
			});

			await this.fetchData(InvalidateCacheFlags.Data);
		}));

		// Add the table data cache onDidUpdate event handler.
		this._register(this._tableDataCache.onDidUpdate(() =>
			this.fireOnDidUpdateEvent()
		));

		// Handle client close
		this._register(this._dataExplorerClientInstance.onDidClose(() => {
			this._onDidCloseEmitter.fire();
		}));
	}

	//#endregion Constructor

	//#region DataGridInstance Properties

	/**
	 * Gets the number of columns.
	 */
	get columns() {
		return this._tableDataCache.columns;
	}

	/**
	 * Gets the number of rows.
	 */
	get rows() {
		return this._tableDataCache.rows;
	}

	//#endregion DataGridInstance Properties

	//#region DataGridInstance Methods

	/**
	 * Sorts the data.
	 * @returns A Promise<void> that resolves when the data is sorted.
	 */
	override async sortData(columnSorts: IColumnSortKey[]): Promise<void> {
		// Set the sort columns.
		await this._dataExplorerClientInstance.setSortColumns(columnSorts.map(columnSort => ({
			column_index: columnSort.columnIndex,
			ascending: columnSort.ascending
		})));

		// Synchronize the backend state.
		await this._dataExplorerClientInstance.updateBackendState();

		// Update the cache
		const columnDescriptor = this.firstColumn;
		const rowDescriptor = this.firstRow;
		if (columnDescriptor && rowDescriptor) {
			await this._tableDataCache.update({
				invalidateCache: InvalidateCacheFlags.Data,
				columnIndices: this._columnLayoutManager.getLayoutIndexes(this.horizontalScrollOffset, this.layoutWidth, OVERSCAN_FACTOR),
				rowIndices: this._rowLayoutManager.getLayoutIndexes(this.verticalScrollOffset, this.layoutHeight, OVERSCAN_FACTOR)
			});
		}
	}

	/**
	 * Fetches data.
	 * @param invalidateCacheFlags The invalidate cache flags.
	 * @returns A Promise<void> that resolves when the operation is complete.
	 */
	override async fetchData(invalidateCacheFlags?: InvalidateCacheFlags) {
		const columnDescriptor = this.firstColumn;
		const rowDescriptor = this.firstRow;

		if (columnDescriptor) {
			await this._tableDataCache.update({
				invalidateCache: invalidateCacheFlags ?? InvalidateCacheFlags.None,
				columnIndices: this._columnLayoutManager.getLayoutIndexes(this.horizontalScrollOffset, this.layoutWidth, OVERSCAN_FACTOR),
				rowIndices: rowDescriptor ? this._rowLayoutManager.getLayoutIndexes(this.verticalScrollOffset, this.layoutHeight, OVERSCAN_FACTOR) : []
			});
		}
	}

	/**
	 * Initializes the grid by fetching backend state and setting up layout.
	 * This should be called once after construction to populate the grid.
	 * Unlike fetchData(), this explicitly gets the backend state first to ensure
	 * layout entries are set up before attempting to fetch data.
	 * @returns A Promise<void> that resolves when initialization is complete.
	 */
	async initialize(): Promise<void> {
		// Get the current backend state
		const state = await this._dataExplorerClientInstance.getBackendState();

		// Set up layout entries from the backend state
		this._columnLayoutManager.setEntries(state.table_shape.num_columns);
		this._rowLayoutManager.setEntries(state.table_shape.num_rows);

		// Now fetch the actual data
		await this.fetchData(InvalidateCacheFlags.All);
	}

	/**
	 * Gets a column.
	 * @param columnIndex The column index.
	 * @returns The column.
	 */
	override column(columnIndex: number) {
		const columnSchema = this._tableDataCache.getColumnSchema(columnIndex);
		if (!columnSchema) {
			return undefined;
		}
		return new PositronDataExplorerColumn(columnSchema);
	}

	/**
	 * Gets a row header.
	 * @param rowIndex The row index.
	 * @returns The row label, or, undefined.
	 */
	override rowHeader(rowIndex: number) {
		return (
			<TableDataRowHeader value={this._tableDataCache.getRowLabel(rowIndex)} />
		);
	}

	/**
	 * Gets a data cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell value.
	 */
	cell(columnIndex: number, rowIndex: number): JSX.Element | undefined {
		const column = this.column(columnIndex);
		if (!column) {
			return undefined;
		}

		const dataCell = this._tableDataCache.getDataCell(columnIndex, rowIndex);
		if (!dataCell) {
			return undefined;
		}

		return (
			<TableDataCell
				column={column}
				dataCell={dataCell}
			/>
		);
	}

	//#endregion DataGridInstance Methods

	//#region Public Properties

	/**
	 * Gets the data explorer client instance.
	 */
	get dataExplorerClientInstance(): DataExplorerClientInstance {
		return this._dataExplorerClientInstance;
	}

	//#endregion Public Properties

	//#region Public Events

	/**
	 * onDidClose event.
	 */
	readonly onDidClose = this._onDidCloseEmitter.event;

	//#endregion Public Events
}
