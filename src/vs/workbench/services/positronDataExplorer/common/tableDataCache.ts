/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';

/**
 * Constants.
 */
const OVERSCAN_FACTOR = 3;
const CHUNK_SIZE = 100;

/**
 * Creates an array from an index range.
 * @param startIndex The start index.
 * @param endIndex The end index.
 * @returns An array with the specified index range.
 */
const arrayFromIndexRange = (startIndex: number, endIndex: number) =>
	Array.from({ length: endIndex - startIndex + 1 }, (_, i) => startIndex + i);

/**
 * UpdateDescriptor interface.
 */
interface UpdateDescriptor {
	firstColumnIndex: number;
	visibleColumns: number;
	firstRowIndex?: number;
	visibleRows?: number;
}

/**
 * DataCellKind enum
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
 * DataCell interface
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
	private _updatingCache = false;

	/**
	 * Gets or sets the cache update descriptor.
	 */
	private _cacheUpdateDescriptor?: UpdateDescriptor;

	/**
	 * Gets or sets the columns.
	 */
	private _columns = 0;

	/**
	 * Gets or sets the rows.
	 */
	private _rows = 0;

	/**
	 * Gets the data explorer client instance that this table data cache is caching data for.
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
	private readonly _dataCellCache = new Map<string, DataCell>();

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
		this._register(this._dataExplorerClientInstance.onDidSchemaUpdate(async () => {
			// Clear the column schema cache, row label cache, and data cell cache.
			this._columnSchemaCache.clear();
			this.invalidateDataCache();
		}));

		// Add the onDidDataUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidDataUpdate(async () => {
			this.invalidateDataCache();
		}));
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

		// On an update event, table shape may have changed
		this._dataExplorerClientInstance.updateBackendState();
	}

	/**
	 * Updates the cache for the specified columns and rows. If data caching isn't needed, omit the
	 * firstRowIndex and visibleRows parameters from the cache update descriptor.
	 * @param cacheUpdateDescriptor The cache update descriptor.
	 */
	async updateCache(cacheUpdateDescriptor: UpdateDescriptor): Promise<void> {
		// Update the cache.
		await this.doUpdateCache(cacheUpdateDescriptor);

		// Fire the onDidUpdateCache event.
		this._onDidUpdateCacheEmitter.fire();
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
		return this._dataCellCache.get(`${columnIndex},${rowIndex}`);
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
	 * Updates the cache.
	 * @param cacheUpdateDescriptor The cache update descriptor.
	 */
	private async doUpdateCache(cacheUpdateDescriptor: UpdateDescriptor): Promise<void> {
		// If a cache update is already in progress, set the cache update descriptor and return.
		// This allows cache updates that are happening in rapid succession to overwrite one
		// another so that only the last one gets processed. (For example, this happens when a user
		// drags a scrollbar rapidly.)
		if (this._updatingCache) {
			this._cacheUpdateDescriptor = cacheUpdateDescriptor;
			return;
		}

		// Set the updating cache flag.
		this._updatingCache = true;

		// Destructure the cache update descriptor.
		const {
			firstColumnIndex,
			visibleColumns,
			firstRowIndex,
			visibleRows
		} = cacheUpdateDescriptor;

		// Get the size of the data.
		const tableState = await this._dataExplorerClientInstance.getBackendState();
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

		// Build an array of the column indices to cache.
		const columnIndices = arrayFromIndexRange(startColumnIndex, endColumnIndex);

		// Build an array of the column schema indices that need to be cached.
		const columnSchemaIndices = columnIndices.filter(columnIndex =>
			!this._columnSchemaCache.has(columnIndex)
		);

		// Initialize the cache updated flag.
		let cacheUpdated = false;

		// If there are column schema indices that need to be cached, cache them.
		if (columnSchemaIndices.length) {
			// Get the schema.
			const tableSchema = await this._dataExplorerClientInstance.getSchema(
				columnSchemaIndices
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

			// If there are row indices that need to be cached, cache them.
			if (rowIndices.length) {
				// Calculate the rows count.
				const rows = rowIndices[rowIndices.length - 1] - rowIndices[0] + 1;

				// Get the data values.
				const tableData = await this._dataExplorerClientInstance.getDataValues(
					rowIndices[0],
					rows,
					columnIndices
				);

				// Update the data cell cache, overwriting any entries we already have cached.
				for (let row = 0; row < rows; row++) {
					const rowIndex = rowIndices[row];

					// Cache the data cells.
					for (let column = 0; column < columnIndices.length; column++) {
						const value = tableData.columns[column][row];
						const columnIndex = columnIndices[column];
						if (typeof value === 'number') {
							this._dataCellCache.set(`${columnIndex},${rowIndex}`,
								decodeSpecialValue(value)
							);
						} else {
							this._dataCellCache.set(`${columnIndex},${rowIndex}`, {
								formatted: value,
								kind: DataCellKind.NON_NULL
							});
						}
					}
				}

				// Get the row labels, if any
				if (tableState.has_row_labels) {
					const rowLabels = await this._dataExplorerClientInstance.getRowLabels(
						{ first_index: rowIndices[0], last_index: rowIndices[0] + rows - 1 }
					);
					for (let row = 0; row < rows; row++) {
						const rowIndex = rowIndices[row];
						const rowLabel = rowLabels.row_labels[0][row];
						this._rowLabelCache.set(rowIndex, rowLabel);
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

		// Clear the updating cache flag.
		this._updatingCache = false;

		// If there is a cache update descriptor, update the cache for it.
		if (this._cacheUpdateDescriptor) {
			// Get the pending cache update descriptor and clear it.
			const pendingCacheUpdateDescriptor = this._cacheUpdateDescriptor;
			this._cacheUpdateDescriptor = undefined;

			// Update the cache for the pending cache update descriptor.
			await this.updateCache(pendingCacheUpdateDescriptor);
		}
	}

	//#endregion Private Methods
}
