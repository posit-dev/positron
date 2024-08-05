/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { arrayFromIndexRange } from 'vs/workbench/services/positronDataExplorer/common/utils';
import { ColumnSchema, TableData } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';

/**
 * Constants.
 */
const TRIM_CACHE_TIMEOUT = 3000;
const OVERSCAN_FACTOR = 3;
const CHUNK_SIZE = 100;

/**
 * InvalidateCacheFlags enum.
 */
export enum InvalidateCacheFlags {
	None = 0,
	ColumnSchema = 1 << 0,
	Data = 1 << 1,
	All = ~(~0 << 2)
}

/**
 * UpdateDescriptor interface.
 */
interface UpdateDescriptor {
	invalidateCache: InvalidateCacheFlags;
	firstColumnIndex: number;
	screenColumns: number;
	firstRowIndex: number;
	screenRows: number;
}

/**
 * DataCellKind enum.
 */
export enum DataCellKind {
	NON_NULL = '',
	NULL = 'null',
	NA = 'na',
	NaN = 'NaN',
	NotATime = 'NaT',
	None = 'None',
	INFINITY = 'inf',
	NEG_INFINITY = 'neginf',
	UNKNOWN = 'unknown'
}

/**
 * DataCell interface.
 */
export interface DataCell {
	formatted: string;
	kind: DataCellKind;
}

const SpecialValues: Record<number, [DataCellKind, string]> = {
	0: [DataCellKind.NULL, 'NULL'],
	1: [DataCellKind.NA, 'NA'],
	2: [DataCellKind.NaN, 'NaN'],
	3: [DataCellKind.NotATime, 'NaT'],
	4: [DataCellKind.None, 'None'],
	10: [DataCellKind.INFINITY, 'INF'],
	11: [DataCellKind.NEG_INFINITY, '-INF'],
};

function decodeSpecialValue(value: number) {
	if (value in SpecialValues) {
		const [kind, formatted] = SpecialValues[value];
		return {
			kind,
			formatted
		};
	} else {
		return {
			kind: DataCellKind.UNKNOWN,
			formatted: 'UNKNOWN'
		};
	}
}

/**
 * TableDataCache class.
 */
export class TableDataCache extends Disposable {
	//#region Private Properties

	/**
	 * Gets or sets a value which indicates whether the cache is being updated.
	 */
	private _updating = false;

	/**
	 * Gets or sets the pending update descriptor.
	 */
	private _pendingUpdateDescriptor?: UpdateDescriptor;

	/**
	 * Gets or sets the trim cache timeout.
	 */
	private _trimCacheTimeout?: NodeJS.Timeout;

	/**
	 * Gets or sets the columns.
	 */
	private _columns = 0;

	/**
	 * Gets or sets the rows.
	 */
	private _rows = 0;

	/**
	 * Gets the column schema cache.
	 */
	private readonly _columnSchemaCache = new Map<number, ColumnSchema>();

	/**
	 * Gets the row label cache.
	 */
	private readonly _rowLabelCache = new Map<number, string>();

	/**
	 * Gets the data column cache.
	 */
	private readonly _dataColumnCache = new Map<number, Map<number, DataCell>>();

	/**
	 * The onDidUpdate event emitter.
	 */
	protected readonly _onDidUpdateEmitter = this._register(new Emitter<void>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _dataExplorerClientInstance The data explorer client instance.
	 */
	constructor(private readonly _dataExplorerClientInstance: DataExplorerClientInstance) {
		// Call the base class's constructor.
		super();
	}

	/**
	 * Dispose method.
	 */
	public override dispose(): void {
		// Clear the trim cache timeout.
		this.clearTrimCacheTimeout();

		// Call the base class's dispose method.
		super.dispose();
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
	 * onDidUpdate event.
	 */
	readonly onDidUpdate = this._onDidUpdateEmitter.event;

	//#endregion Public Events

	//#region Public Methods

	/**
	 * Updates the cache.
	 * @param updateDescriptor The update descriptor.
	 */
	async update(updateDescriptor: UpdateDescriptor): Promise<void> {
		// If a cache update is already in progress, set the pending update descriptor and return.
		// This allows cache updates that are happening in rapid succession to overwrite one another
		// so that only the last one gets processed. (For example, this happens when a user drags a
		// scrollbar rapidly.)
		if (this._updating) {
			this._pendingUpdateDescriptor = updateDescriptor;
			return;
		}

		// Clear the trim cache timeout.
		this.clearTrimCacheTimeout();

		// Set the updating flag.
		this._updating = true;

		// Destructure the update descriptor.
		const {
			invalidateCache,
			firstColumnIndex,
			screenColumns,
			firstRowIndex,
			screenRows
		} = updateDescriptor;

		// Get the invalidate cache flags.
		const invalidateColumnSchemaCache = (invalidateCache & InvalidateCacheFlags.ColumnSchema)
			=== InvalidateCacheFlags.ColumnSchema;
		const invalidateDataCache = (invalidateCache & InvalidateCacheFlags.Data)
			=== InvalidateCacheFlags.Data;

		// Get the size of the data.
		const tableState = await this._dataExplorerClientInstance.getBackendState();
		this._columns = tableState.table_shape.num_columns;
		this._rows = tableState.table_shape.num_rows;

		// Set the start column index and the end column index of the columns to cache.
		const overscanColumns = screenColumns * OVERSCAN_FACTOR;
		const startColumnIndex = Math.max(
			0,
			firstColumnIndex - overscanColumns
		);
		const endColumnIndex = Math.min(
			this._columns - 1,
			firstColumnIndex + screenColumns + overscanColumns,
		);

		// Set the column indices of the column schema we need to load.
		let columnIndices: number[];
		if (invalidateColumnSchemaCache) {
			columnIndices = arrayFromIndexRange(startColumnIndex, endColumnIndex);
		} else {
			columnIndices = [];
			for (let columnIndex = startColumnIndex; columnIndex <= endColumnIndex; columnIndex++) {
				if (!this._columnSchemaCache.has(columnIndex)) {
					columnIndices.push(columnIndex);
				}
			}
		}

		// Load the column schema.
		const tableSchema = await this._dataExplorerClientInstance.getSchema(columnIndices);

		// Clear the column schema cache, if we're supposed to.
		if (invalidateColumnSchemaCache) {
			this._columnSchemaCache.clear();
		}

		// Cache the column schema that was returned.
		for (let column = 0; column < tableSchema.columns.length; column++) {
			this._columnSchemaCache.set(columnIndices[column], tableSchema.columns[column]);
		}

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();

		// Set the start row index and the end row index of the rows to cache.
		const overscanRows = screenRows * OVERSCAN_FACTOR;
		const startRowIndex = Math.max(
			0,
			firstRowIndex - overscanRows
		);
		const endRowIndex = Math.min(
			this._rows - 1,
			firstRowIndex + screenRows + overscanRows
		);

		// Set the column indices and row indices of the data values to load.
		let rowIndices: number[];
		if (invalidateDataCache) {
			columnIndices = arrayFromIndexRange(startColumnIndex, endColumnIndex);
			rowIndices = arrayFromIndexRange(startRowIndex, endRowIndex);
		} else {
			const columnIndicesToCache = new Set<number>();
			const rowIndicesToCache = new Set<number>();
			for (let columnIndex = startColumnIndex; columnIndex <= endColumnIndex; columnIndex++) {
				const dataColumn = this._dataColumnCache.get(columnIndex);
				if (!dataColumn) {
					columnIndicesToCache.add(columnIndex);
				} else {
					for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex++) {
						if (!dataColumn.has(rowIndex)) {
							columnIndicesToCache.add(columnIndex);
							rowIndicesToCache.add(rowIndex);
							break;
						}
					}
				}
			}

			// Set the column indices and row indices.
			columnIndices = Array.from(columnIndicesToCache).sort((a, b) => a - b);
			rowIndices = arrayFromIndexRange(startRowIndex, endRowIndex);
		}

		// Get the data values.
		const tableData: TableData = await this._dataExplorerClientInstance.getDataValues(
			rowIndices[0],											// SOON TO BE AN ARRAY
			rowIndices[rowIndices.length - 1] - rowIndices[0] + 1,	// SOON TO BE AN ARRAY
			columnIndices
		);

		// Clear the data cache, if we're supposed to.
		if (invalidateDataCache) {
			this._rowLabelCache.clear();
			this._dataColumnCache.clear();
		}

		// // Update the row labels cache.
		// if (tableData.row_labels) {
		// 	for (let row = 0; row < tableData.row_labels[0].length; row++) {
		// 		this._rowLabelCache.set(rowIndices[row], tableData.row_labels[0][row]);
		// 	}
		// }

		// Update the data column cache.
		for (let column = 0; column < tableData.columns.length; column++) {
			// Get the column index.
			const columnIndex = columnIndices[column];

			// Get or create the data column.
			let dataColumn = this._dataColumnCache.get(columnIndex);
			if (!dataColumn) {
				dataColumn = new Map<number, DataCell>();
				this._dataColumnCache.set(columnIndex, dataColumn);
			}

			// Update the cell values.
			for (let row = 0; row < tableData.columns[column].length; row++) {
				// Get the cell value.
				const value = tableData.columns[column][row];

				// Convert the cell value into a data cell.
				let dataCell: DataCell;
				if (typeof value === 'number') {
					dataCell = decodeSpecialValue(value);
				} else {
					dataCell = {
						formatted: value,
						kind: DataCellKind.NON_NULL
					};
				}

				// Cache the cell value.
				dataColumn.set(rowIndices[row], dataCell);
			}
		}

		// If the cache was updated, fire the onDidUpdateCache event.
		this._onDidUpdateEmitter.fire();

		// Clear the updating flag.
		this._updating = false;

		// If there's a pending update descriptor, update the cache again; otherwise, trim the
		// caches that were not invalidated.
		if (this._pendingUpdateDescriptor) {
			// Get the pending update descriptor and clear it.
			const pendingUpdateDescriptor = this._pendingUpdateDescriptor;
			this._pendingUpdateDescriptor = undefined;

			// Update the cache for the pending update descriptor.
			return this.update(pendingUpdateDescriptor);
		}

		// If the cache was invalidated, there's no need to trim the cache.
		if (invalidateCache !== InvalidateCacheFlags.All) {
			// Set the trim cache timeout.
			this._trimCacheTimeout = setTimeout(() => {
				// Release the trim cache timeout.
				this._trimCacheTimeout = undefined;

				// Trim the column schema cache, if it wasn't invalidated.
				if (!invalidateColumnSchemaCache) {
					this.trimColumnSchemaCache(startColumnIndex, endColumnIndex);
				}

				// Trim the data cache, if it wasn't invalidated.
				if (!invalidateDataCache) {
					this.trimDataCache(
						startColumnIndex,
						endColumnIndex,
						startRowIndex,
						endRowIndex
					);
				}
			}, TRIM_CACHE_TIMEOUT);
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
	 * Gets the data cell for the specified column index and row index.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The data cell for the specified column index and row index.
	 */
	getDataCell(columnIndex: number, rowIndex: number) {
		return this._dataColumnCache.get(columnIndex)?.get(rowIndex);
	}

	/**
	 * Gets the table data.
	 * @returns The table data as a TSV string.
	 */
	async getTableData(): Promise<string> {
		// The cell values.
		const cellValues = new Map<string, string>();

		// Loop over chunks of columns.
		for (let columnIndex = 0; columnIndex < this._columns; columnIndex += CHUNK_SIZE) {
			// Loop over chunks of rows.
			for (let rowIndex = 0; rowIndex < this._rows; rowIndex += CHUNK_SIZE) {
				// Get the table data.
				const maxColumnIndex = Math.min(columnIndex + CHUNK_SIZE, this._columns);
				const maxRowIndex = Math.min(rowIndex + CHUNK_SIZE, this._rows);
				const tableData = await this._dataExplorerClientInstance.getDataValues(
					rowIndex,
					maxRowIndex,
					arrayFromIndexRange(columnIndex, maxColumnIndex)
				);

				// Process the table data into cell values.
				for (let ci = 0; ci < maxColumnIndex - columnIndex; ci++) {
					for (let ri = 0; ri < maxRowIndex - rowIndex; ri++) {
						// Get the cell value.
						const cellValue = tableData.columns[ci][ri];

						// Add the cell.
						if (typeof cellValue === 'number') {
							cellValues.set(
								`${rowIndex + ri},${columnIndex + ci}`,
								decodeSpecialValue(cellValue).formatted
							);
						} else {
							cellValues.set(`${rowIndex + ri},${columnIndex + ci}`, cellValue);
						}
					}
				}
			}
		}

		// Build the result.
		let result = '';
		for (let rowIndex = 0; rowIndex < this._rows; rowIndex++) {
			// Append the newline before writing the row to the result.
			if (rowIndex) {
				result += '\n';
			}

			// Write the row to the result.
			for (let columnIndex = 0; columnIndex < this._columns; columnIndex++) {
				// Append the tab separator before writing the cell value.
				if (columnIndex) {
					result += '\t';
				}

				// Write the cell value to the row.
				result += cellValues.get(`${rowIndex},${columnIndex}`);
			}
		}

		// Done.
		return result;
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Clears the trim cache timeout.
	 */
	private clearTrimCacheTimeout() {
		// If there is a trim cache timeout scheduled, clear it.
		if (this._trimCacheTimeout) {
			clearTimeout(this._trimCacheTimeout);
			this._trimCacheTimeout = undefined;
		}
	}

	/**
	 * Trims the column schema cache.
	 * @param startColumnIndex The start column index.
	 * @param endColumnIndex The end column index.
	 */
	private trimColumnSchemaCache(startColumnIndex: number, endColumnIndex: number) {
		// Trim the column schema cache.
		for (const columnIndex of this._columnSchemaCache.keys()) {
			if (columnIndex < startColumnIndex || columnIndex > endColumnIndex) {
				this._columnSchemaCache.delete(columnIndex);
			}
		}
	}

	/**
	 * Trims the data cache.
	 * @param startColumnIndex The start column index.
	 * @param endColumnIndex The end column index.
	 * @param startRowIndex The start row index.
	 * @param endRowIndex The end row index.
	 */
	private trimDataCache(
		startColumnIndex: number,
		endColumnIndex: number,
		startRowIndex: number,
		endRowIndex: number
	) {
		// Trim the row label cache.
		for (const rowIndex of this._rowLabelCache.keys()) {
			if (rowIndex < startRowIndex || rowIndex > endRowIndex) {
				this._rowLabelCache.delete(rowIndex);
			}
		}

		// Trim the data column cache.
		for (const columnIndex of this._dataColumnCache.keys()) {
			if (columnIndex < startColumnIndex || columnIndex > endColumnIndex) {
				this._dataColumnCache.delete(columnIndex);
			} else {
				const dataColumn = this._dataColumnCache.get(columnIndex);
				if (dataColumn) {
					for (const rowIndex of dataColumn.keys()) {
						if (rowIndex < startRowIndex || rowIndex > endRowIndex) {
							dataColumn.delete(rowIndex);
						}
					}
				}
			}
		}
	}

	//#endregion Private Methods
}
