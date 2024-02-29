/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ColumnSchema, TableData } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';

/**
 * Constants.
 */
const OVERSCAN_FACTOR = 3;

/**
 * Creates an array from an index range.
 * @param startIndex The start index.
 * @param endIndex The end index.
 * @returns An array with the specified index range.
 */
const arrayFromIndexRange = (startIndex: number, endIndex: number) =>
	Array.from({ length: endIndex - startIndex + 1 }, (_, i) => startIndex + i);

/**
 * DataExplorerCache class.
 */
export class DataExplorerCache extends Disposable {
	//#region Private Properties

	/**
	 * Gets or sets the columns.
	 */
	private _columns = 0;

	/**
	 * Gets or sets the rows.
	 */
	private _rows = 0;

	/**
	 * Gets the data explorer client instance that this data explorer cache is caching data for.
	 */
	private readonly _dataExplorerClientInstance: DataExplorerClientInstance;

	/**
	 * Gets the column schema cache.
	 */
	private readonly _columnSchemaCache = new Map<number, ColumnSchema>();

	/**
	 * Gets the row label cache.
	 */
	private readonly _rowLabelCache = new Map<number, string>();

	/**
	 * Gets the data cell cache.
	 */
	private readonly _dataCellCache = new Map<string, string>();

	/**
	 * The onDidUpdateCache event emitter.
	 */
	protected readonly _onDidUpdateCacheEmitter = this._register(new Emitter<void>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param dataExplorerClientInstance The DataExplorerClientInstance.
	 */
	constructor(dataExplorerClientInstance: DataExplorerClientInstance) {
		// Call the base class's constructor.
		super();

		// Set the data explorer client instance.
		this._dataExplorerClientInstance = dataExplorerClientInstance;

		// Add the onDidSchemaUpdate event handler.
		this._dataExplorerClientInstance.onDidSchemaUpdate(async () => {
			// Clear the column schema cache, row label cache, and data cell cache.
			this._columnSchemaCache.clear();
			this._rowLabelCache.clear();
			this._dataCellCache.clear();
		});

		// Add the onDidDataUpdate event handler.
		this._dataExplorerClientInstance.onDidDataUpdate(async () => {
			// Clear the row label cache and data cell cache.
			this._rowLabelCache.clear();
			this._dataCellCache.clear();
		});
	}

	//#endregion Constructor & Dispose

	//#region Public Properties

	/**
	 * Gets the columns.
	 */
	get columns() {
		return this._columns;
	}

	/**
	 * Gets the rows.
	 */
	get rows() {
		return this._rows;
	}

	//#endregion Public Properties

	//#region Public Events

	/**
	 * onDidUpdateCache event.
	 */
	readonly onDidUpdateCache = this._onDidUpdateCacheEmitter.event;

	//#endregion Public Events

	//#region Public Methods

	/**
	 * Invalidates the data cache.
	 */
	invalidateDataCache() {
		this._rowLabelCache.clear();
		this._dataCellCache.clear();
	}

	/**
	 * Updates the cache for the specified columns and rows. If data caching isn't needed, omit the
	 * firstRowIndex and visibleRows parameters.
	 * @param firstColumnIndex The first column index.
	 * @param visibleColumns The number of visible columns.
	 * @param firstRowIndex The first row index.
	 * @param visibleRows The number of visible rows.
	 */
	async updateCache(
		firstColumnIndex: number,
		visibleColumns: number,
		firstRowIndex?: number,
		visibleRows?: number
	): Promise<void> {
		// Get the size of the data.
		const tableState = await this._dataExplorerClientInstance.getState();
		this._columns = tableState.table_shape.num_columns;
		this._rows = tableState.table_shape.num_rows;

		// Set the start column index and the end column index of the columns to cache.
		const startColumnIndex = Math.max(
			firstColumnIndex - (visibleColumns * OVERSCAN_FACTOR),
			0
		);
		const endColumnIndex = Math.min(
			startColumnIndex + visibleColumns + (visibleColumns * OVERSCAN_FACTOR * 2),
			this._columns - 1
		);

		// Build an array of the column indicies to cache.
		const columnIndicies = arrayFromIndexRange(startColumnIndex, endColumnIndex);

		// Build an array of the column schema indices that need to be cached.
		const columnSchemaIndices = columnIndicies.filter(columnIndex =>
			!this._columnSchemaCache.has(columnIndex)
		);

		// Set the cache updated flag.
		let cacheUpdated = false;

		// If there are column schema indices that need to be cached, cache them.
		if (columnSchemaIndices.length) {
			// Get the schema.
			const tableSchema = await this._dataExplorerClientInstance.getSchema(
				columnSchemaIndices[0],
				columnSchemaIndices[columnSchemaIndices.length - 1] - columnSchemaIndices[0] + 1
			);

			// Update the column schema cache, overwriting any entries we already have cached.
			for (let i = 0; i < tableSchema.columns.length; i++) {
				this._columnSchemaCache.set(columnSchemaIndices[0] + i, tableSchema.columns[i]);
			}

			// Update the cache updated flag.
			cacheUpdated = true;
		}

		// If data is also being cached, update the data cache.
		if (firstRowIndex !== undefined && visibleRows !== undefined) {
			// Set the start row index and the end row index of the rows to cache.
			const startRowIndex = Math.max(
				firstRowIndex - (visibleRows * OVERSCAN_FACTOR),
				0
			);
			const endRowIndex = Math.min(
				startRowIndex + visibleRows + (visibleRows * OVERSCAN_FACTOR * 2),
				this._rows - 1
			);

			// Build an array of the row indices that need to be cached.
			const rowIndices: number[] = [];
			for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex++) {
				for (let columnIndex = startColumnIndex; columnIndex <= endColumnIndex; columnIndex++) {
					if (!this._dataCellCache.has(`${columnIndex},${rowIndex}`)) {
						rowIndices.push(rowIndex);
						break;
					}
				}
			}

			if (rowIndices.length) {
				const rows = rowIndices[rowIndices.length - 1] - rowIndices[0] + 1;
				const tableData: TableData = await this._dataExplorerClientInstance.getDataValues(
					rowIndices[0],
					rows,
					columnIndicies
				);

				for (let row = 0; row < rows; row++) {
					const rowIndex = rowIndices[row];

					if (tableData.row_labels) {
						const rowLabel = tableData.row_labels[0][row];
						this._rowLabelCache.set(rowIndex, rowLabel);
					}

					for (let column = 0; column < columnIndicies.length; column++) {
						const value = tableData.columns[column][row];

						const columnIndex = columnIndicies[column];
						const rowIndex = rowIndices[row];

						this._dataCellCache.set(`${columnIndex},${rowIndex}`, value);
					}
				}

				// Update the cache updated flag.
				cacheUpdated = true;
			}
		}

		// If the cache was updated, fire the onDidUpdateCache event.
		if (cacheUpdated) {
			this._onDidUpdateCacheEmitter.fire();
		}
	}

	/**
	 * Gets the column schema for the specified column index.
	 * @param columnIndex The column index.
	 * @returns The column schema for the specified column index.
	 */
	getColumnSchema(columnIndex: number) {
		return this._columnSchemaCache.get(columnIndex);
	}

	/**
	 * Gets the row label for the specified row index.
	 * @param rowIndex The row index.
	 * @returns The row label for the specified column index.
	 */
	getRowLabel(rowIndex: number) {
		return this._rowLabelCache.get(rowIndex) ?? `${rowIndex}`;
	}

	/**
	 * Gets the cell value for the specified column index and row index.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The cell value for the specified column index and row index.
	 */
	getCellValue(columnIndex: number, rowIndex: number) {
		return this._dataCellCache.get(`${columnIndex},${rowIndex}`);
	}

	//#endregion Public Methods
}
