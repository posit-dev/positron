/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { arrayFromIndexRange } from 'vs/workbench/services/positronDataExplorer/common/utils';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { ArraySelection, ColumnSchema, ColumnSelection, DataSelectionIndices, DataSelectionRange } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

/**
 * Constants.
 */
const TRIM_CACHE_TIMEOUT = 3000;
const OVERSCAN_FACTOR = 3;
const CHUNK_SIZE = 4096;

/**
 * InvalidateCacheFlags enum.
 */
export enum InvalidateCacheFlags {
	None = 0,
	ColumnSchema = 1 << 0,
	Data = 1 << 1,
	All = ColumnSchema | Data
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
 * Custom type guard for DataSelectionRange.
 * @param arraySelection The array selection.
 * @returns true if the value is a DataSelectionRange; otherwise, false.
 */
const isDataSelectionRange = (
	arraySelection: ArraySelection
): arraySelection is DataSelectionRange =>
	(arraySelection as DataSelectionRange).first_index !== undefined &&
	(arraySelection as DataSelectionRange).last_index !== undefined;

/**
 * Custom type guard for DataSelectionIndices.
 * @param arraySelection The array selection.
 * @returns true if the value is a DataSelectionIndices; otherwise, false.
 */
const isDataSelectionIndices = (
	arraySelection: ArraySelection
): arraySelection is DataSelectionIndices =>
	(arraySelection as DataSelectionIndices).indices !== undefined;

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
	 * Gets or sets the column header width calculator.
	 */
	private _columnHeaderWidthCalculator?: (columnName: string, typeName: string) => number;

	/**
	 * Gets or sets the column value width calculator.
	 */
	private _columnValueWidthCalculator?: (length: number) => number;

	/**
	 * Gets the column schema cache.
	 */
	private readonly _columnSchemaCache = new Map<number, ColumnSchema>();

	/**
	 * Gets the column header width cache.
	 */
	private readonly _columnHeaderWidthCache = new Map<number, number>();

	/**
	 * Gets the row label cache.
	 */
	private readonly _rowLabelCache = new Map<number, string>();

	/**
	 * Gets the data column cache.
	 */
	private readonly _dataColumnCache = new Map<number, Map<number, DataCell>>();

	/**
	 * Gets the column value width cache.
	 */
	private readonly _columnValueWidthCache = new Map<number, number>();

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
	 * Sets the column header width calculator.
	 * @param calculator The column header width calculator.
	 */
	setColumnHeaderWidthCalculator(calculator?: (columnName: string, typeName: string) => number) {
		// Set the column header width calculator.
		this._columnHeaderWidthCalculator = calculator;

		// Refresh the column header width cache, if the column header width calculator is non-null.
		if (this._columnHeaderWidthCalculator) {
			// Clear the existing column header width cache.
			this._columnHeaderWidthCache.clear();

			// Refresh the column header width cache.
			for (const [columnIndex, columnSchema] of this._columnSchemaCache.entries()) {
				// Calculate the column header width.
				const columnHeaderWidth = this._columnHeaderWidthCalculator(
					columnSchema.column_name,
					columnSchema.type_name
				);

				// If the column header width is non-zero, cache its width.
				if (columnHeaderWidth) {
					this._columnHeaderWidthCache.set(columnIndex, columnHeaderWidth);
				}
			}
		}
	}

	/**
	 * Sets the column value width calculator.
	 * @param calculator The column value width calculator.
	 */
	setColumnValueWidthCalculator(calculator?: (length: number) => number) {
		// Set the column value width calculator.
		this._columnValueWidthCalculator = calculator;

		// Refresh the column value width cache, if the column value width calculator is non-null.
		if (this._columnValueWidthCalculator) {
			// Clear the existing column value width cache.
			this._columnValueWidthCache.clear();

			// Refresh the column value width cache.
			for (const [columnIndex, dataColumn] of this._dataColumnCache.entries()) {
				// Find the longest data cell.
				let longestDataCell = 0;
				for (const dataCell of dataColumn.values()) {
					if (dataCell.formatted.length > longestDataCell) {
						longestDataCell = dataCell.formatted.length;
					}
				}

				// If the longest data cell is non-zero, calculate and cache its width.
				this._columnValueWidthCache.set(
					columnIndex,
					this._columnValueWidthCalculator(longestDataCell)
				);
			}
		}
	}

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

		// Set the invalidate cache flags.
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

		// Load the column schemas we need to load.
		const tableSchema = await this._dataExplorerClientInstance.getSchema(columnIndices);

		// Clear the column schema cache, if we're supposed to.
		if (invalidateColumnSchemaCache) {
			this._columnSchemaCache.clear();
			this._columnHeaderWidthCache.clear();
		}

		// Cache the column schemas that were returned.
		for (let i = 0; i < tableSchema.columns.length; i++) {
			// Get the column schema and compute the column index.
			const columnIndex = columnIndices[i];
			const columnSchema = tableSchema.columns[i];

			// Cache the column schema.
			this._columnSchemaCache.set(columnIndex, columnSchema);

			// Update the column header width cache.
			if (this._columnHeaderWidthCalculator) {
				this._columnHeaderWidthCache.set(columnIndex, this._columnHeaderWidthCalculator(
					columnSchema.column_name,
					columnSchema.type_name
				));
			}
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

		// Build an array of the column selections to load.
		const columns: ColumnSelection[] = [];
		if (invalidateDataCache) {
			// The data cache is being invalidated. Load everything.
			for (let columnIndex = startColumnIndex; columnIndex <= endColumnIndex; columnIndex++) {
				columns.push({
					column_index: columnIndex,
					spec: {
						first_index: startRowIndex,
						last_index: endRowIndex
					}
				});
			}
		} else {
			// The cache is not being invalidated. Load only the cells that we don't have cached.
			for (let columnIndex = startColumnIndex; columnIndex <= endColumnIndex; columnIndex++) {
				const dataColumn = this._dataColumnCache.get(columnIndex);
				if (!dataColumn) {
					// The data column isn't cached. Load it.
					columns.push({
						column_index: columnIndex,
						spec: {
							first_index: startRowIndex,
							last_index: endRowIndex
						}
					});
				} else {
					// The data column is cached. Load any cells that are not cached.
					let contiguous = true;
					const indices: number[] = [];
					for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex++) {
						if (!dataColumn.has(rowIndex)) {
							// Add the index.
							indices.push(rowIndex);

							// Check whether the indices are contiguous.
							if (contiguous &&
								indices.length > 1 &&
								indices[indices.length - 2] + 1 !== indices[indices.length - 1]
							) {
								contiguous = false;
							}
						}
					}

					// If there are cells that are not cached, add the column and its spec.
					if (indices.length) {
						if (!contiguous) {
							columns.push({
								column_index: columnIndex,
								spec: {
									indices: indices
								}
							});
						} else {
							columns.push({
								column_index: columnIndex,
								spec: {
									first_index: indices[0],
									last_index: indices[indices.length - 1]
								}
							});
						}
					}
				}
			}
		}

		// Get the data values.
		const tableData = await this._dataExplorerClientInstance.getDataValues(columns);

		// Get the row labels.
		let rowLabels: ArraySelection | undefined;
		if (!tableState.has_row_labels) {
			rowLabels = undefined;
		} else {
			if (invalidateDataCache) {
				rowLabels = { first_index: startRowIndex, last_index: endRowIndex };
			} else {
				let contiguous = true;
				const indices: number[] = [];
				for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex++) {
					if (!this._rowLabelCache.has(rowIndex)) {
						// Add the index.
						indices.push(rowIndex);

						// Check whether the indices are contiguous.
						if (contiguous &&
							indices.length > 1 &&
							indices[indices.length - 2] + 1 !== indices[indices.length - 1]
						) {
							contiguous = false;
						}
					}
				}

				// If there are labels that are not cached,
				if (!indices.length) {
					rowLabels = undefined;
				} else {
					if (!contiguous) {
						rowLabels = { indices };
					} else {
						rowLabels = {
							first_index: indices[0],
							last_index: indices[indices.length - 1]
						};
					}
				}
			}
		}

		// Get the table row labels.
		const tableRowLabels = !rowLabels ?
			undefined :
			await this._dataExplorerClientInstance.getRowLabels(rowLabels);

		// Clear the data cache, if we're supposed to.
		if (invalidateDataCache) {
			this._rowLabelCache.clear();
			this._dataColumnCache.clear();
			this._columnValueWidthCache.clear();
		}

		// Update the data column cache.
		for (let column = 0; column < tableData.columns.length; column++) {
			// Get the column selection.
			const columnSelection = columns[column];

			// Get or create the data column.
			let dataColumn = this._dataColumnCache.get(columnSelection.column_index);
			if (!dataColumn) {
				dataColumn = new Map<number, DataCell>();
				this._dataColumnCache.set(columnSelection.column_index, dataColumn);
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

				// Set the row index.
				let rowIndex: number;
				if (isDataSelectionRange(columnSelection.spec)) {
					rowIndex = columnSelection.spec.first_index + row;
				} else if (isDataSelectionIndices(columnSelection.spec)) {
					rowIndex = columnSelection.spec.indices[row];
				} else {
					continue;
				}

				// Cache the cell.
				dataColumn.set(rowIndex, dataCell);

				// Update the column value width cache.
				if (dataCell.formatted.length && this._columnValueWidthCalculator) {
					// Get the cached column value width and the column value width.
					const cachedColumnValueWidth = this._columnValueWidthCache.get(
						columnSelection.column_index
					);
					const columnValueWidth = this._columnValueWidthCalculator(
						dataCell.formatted.length
					);

					// Update the column value width cache as needed.
					if (!cachedColumnValueWidth || columnValueWidth > cachedColumnValueWidth) {
						this._columnValueWidthCache.set(columnSelection.column_index, columnValueWidth);
					}
				}
			}
		}

		// Update the row labels cache.
		if (rowLabels && tableRowLabels) {
			for (let row = 0; row < tableRowLabels.row_labels[0].length; row++) {
				// Set the row index.
				let rowIndex: number;
				if (isDataSelectionRange(rowLabels)) {
					rowIndex = rowLabels.first_index + row;
				} else if (isDataSelectionIndices(rowLabels)) {
					rowIndex = rowLabels.indices[row];
				} else {
					continue;
				}

				// Cache the row label.
				this._rowLabelCache.set(rowIndex, tableRowLabels.row_labels[0][row]);
			}
		}

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();

		// Clear the updating flag.
		this._updating = false;

		// If there's a pending update descriptor, update the cache again.
		if (this._pendingUpdateDescriptor) {
			// Get the pending update descriptor and clear it.
			const pendingUpdateDescriptor = this._pendingUpdateDescriptor;
			this._pendingUpdateDescriptor = undefined;

			// Update the cache for the pending update descriptor.
			return this.update(pendingUpdateDescriptor);
		}

		// Schedule trimming the cache.
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
	 * Gets the column header width for the specified column index.
	 * @param columnIndex The column index.
	 * @returns The column header width for the specified column index
	 */
	getColumnHeaderWidth(columnIndex: number) {
		return this._columnHeaderWidthCache.get(columnIndex);
	}

	/**
	 * Gets the column value width for the specified column index.
	 * @param columnIndex The column index.
	 * @returns The column value width for the specified column index
	 */
	getColumnValueWidth(columnIndex: number) {
		return this._columnValueWidthCache.get(columnIndex);
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
	 * Gets the table data TSV.
	 * @returns The table data as a TSV string.
	 */
	async getTableDataTSV(): Promise<string> {
		// The cell values.
		const cellValues = new Map<string, string>();

		// Loop over chunks of columns.
		for (let startColumnIndex = 0;
			startColumnIndex < this._columns;
			startColumnIndex += CHUNK_SIZE
		) {
			// Calculate the end column index.
			const endColumnIndex = Math.min(startColumnIndex + CHUNK_SIZE - 1, this._columns - 1);

			// Loop over chunks of rows.
			for (let startRowIndex = 0; startRowIndex < this._rows; startRowIndex += CHUNK_SIZE) {
				// Calculate the end row index.
				const endRowIndex = Math.min(startRowIndex + CHUNK_SIZE - 1, this._rows - 1);

				// Build an array of the column selections to load.
				const columns: ColumnSelection[] = [];
				for (let columnIndex = startColumnIndex;
					columnIndex <= endColumnIndex;
					columnIndex++
				) {
					columns.push({
						column_index: columnIndex,
						spec: {
							first_index: startRowIndex,
							last_index: endRowIndex
						}
					});
				}

				// Get the table data.
				const tableData = await this._dataExplorerClientInstance.getDataValues(columns);

				// Process the table data into cell values.
				for (let column = 0; column < tableData.columns.length; column++) {
					// Get the column selection.
					const columnSelection = columns[column];

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

						// Set the row index.
						let rowIndex: number;
						if (isDataSelectionRange(columnSelection.spec)) {
							rowIndex = columnSelection.spec.first_index + row;
						} else {
							continue;
						}

						// Add the cell value.
						cellValues.set(
							`${rowIndex},${columnSelection.column_index}`,
							dataCell.formatted
						);
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
