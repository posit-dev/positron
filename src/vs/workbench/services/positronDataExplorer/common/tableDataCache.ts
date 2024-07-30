/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { arrayFromIndexRange } from 'vs/workbench/services/positronDataExplorer/common/utils';
import { ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';

/**
 * Constants.
 */
const OVERSCAN_FACTOR = 3;
const CHUNK_SIZE = 100;

/**
 * UpdateDescriptor interface.
 */
interface UpdateDescriptor {
	firstColumnIndex: number;
	visibleColumns: number;
	firstRowIndex: number;
	visibleRows: number;
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
	kind: DataCellKind;
	formatted: string;
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

function decodeSpecialValue(value: number): DataCell {
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
	 * Gets or sets a value which indicates whether an update is in progress.
	 */
	private _updating = false;

	/**
	 * Gets or sets the pending update descriptor.
	 */
	private _pendingUpdateDescriptor?: UpdateDescriptor;

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
	 * Gets the column value width cache.
	 */
	private readonly _columnValueWidthCache = new Map<number, number>();

	/**
	 * Gets the row label cache.
	 */
	private readonly _rowLabelCache = new Map<number, string>();

	/**
	 * Gets the data column cache.
	 */
	private readonly _dataColumnCache = new Map<number, Map<number, DataCell>>();

	/**
	 * The onDidUpdateCache event emitter.
	 */
	protected readonly _onDidUpdateCache = this._register(new Emitter<void>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 */
	constructor(private readonly _dataExplorerClientInstance: DataExplorerClientInstance) {
		// Call the base class's constructor.
		super();

		// Add the onDidSchemaUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidSchemaUpdate(async () => {
			// Clear the column schema cache, row label cache, and data cell cache.
			this._columnSchemaCache.clear();
			this.invalidateCache();
		}));

		// Add the onDidDataUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidDataUpdate(async () => {
			this.invalidateCache();
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
	readonly onDidUpdateCache = this._onDidUpdateCache.event;

	//#endregion Public Events

	//#region Public Methods

	/**
	 * Sets the column header width calculator.
	 * @param calculator The column header width calculator.
	 */
	setColumnHeaderWidthCalculator(calculator?: (columnName: string, typeName: string) => number) {
		// Set the column header width calculator.
		this._columnHeaderWidthCalculator = calculator;

		// Refresh the column header width cache.
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

				// If the column header width is non-zero, cache it.
				if (columnHeaderWidth) {
					this._columnHeaderWidthCache.set(columnIndex, columnHeaderWidth);
				}
			}
		}
	}

	/**
	 * Sets the column value width calculator.
	 * @param columnHeaderWidthCalculator The column value width calculator.
	 */
	setColumnValueWidthCalculator(calculator?: (length: number) => number) {
		this._columnValueWidthCalculator = calculator;

		// Refresh the column header width cache.
		if (this._columnValueWidthCalculator) {
			this._columnValueWidthCache.clear();
			for (const [columnIndex, yaya] of this._dataColumnCache.entries()) {
				let length = 0;
				for (const [, dataCell] of yaya) {
					if (dataCell.formatted.length > length) {
						length = dataCell.formatted.length;
					}
				}

				this._columnValueWidthCache.set(columnIndex, this._columnValueWidthCalculator(length));
			}
		}
	}

	/**
	 * Invalidates the cache.
	 */
	invalidateCache() {
		// Clear the row label cache and the data column cache.
		this._rowLabelCache.clear();
		this._dataColumnCache.clear();

		// On an update event, table shape may have changed
		this._dataExplorerClientInstance.updateBackendState();
	}

	/**
	 * Updates the cache.
	 * @param updateDescriptor The update descriptor.
	 */
	async updateCache(updateDescriptor: UpdateDescriptor): Promise<void> {
		// Update the cache.
		await this.doUpdateCache(updateDescriptor);

		// Fire the onDidUpdateCache event.
		this._onDidUpdateCache.fire();
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
	 * @param updateDescriptor The update descriptor.
	 */
	private async doUpdateCache(updateDescriptor: UpdateDescriptor): Promise<void> {
		// console.log(`++++++++++ TableDataCache doUpdateCache`);
		// console.log(`    firstColumnIndex: ${updateDescriptor.firstColumnIndex}`);
		// console.log(`      visibleColumns: ${updateDescriptor.visibleColumns}`);
		// console.log(`       firstRowIndex: ${updateDescriptor.firstRowIndex}`);
		// console.log(`         visibleRows: ${updateDescriptor.visibleRows}`);

		// If a cache update is already in progress, set the pending update descriptor and return.
		// This allows cache updates that are happening in rapid succession to overwrite one another
		// so that only the last one gets processed. (For example, this happens when a user drags a
		// scrollbar rapidly.)
		if (this._updating) {
			this._pendingUpdateDescriptor = updateDescriptor;
			return;
		}

		// Set the updating flag.
		this._updating = true;

		// Destructure the update descriptor.
		const {
			firstColumnIndex,
			visibleColumns,
			firstRowIndex,
			visibleRows
		} = updateDescriptor;

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
			firstColumnIndex + visibleColumns + (visibleColumns * OVERSCAN_FACTOR),
			this._columns - 1
		);

		// Build the column indicies we need to cache.
		const columnIndices: number[] = [];
		for (let columnIndex = startColumnIndex; columnIndex <= endColumnIndex; columnIndex++) {
			if (!this._columnSchemaCache.get(columnIndex)) {
				columnIndices.push(columnIndex);
			}
		}


		// Initialize the cache updated flag.
		let cacheUpdated = false;

		// If there are column schema indices that need to be cached, cache them.
		if (columnIndices.length) {
			// Get the schema.
			const tableSchema = await this._dataExplorerClientInstance.getSchema(columnIndices);

			// Update the column schema cache, overwriting any entries we already have cached.
			for (let i = 0; i < tableSchema.columns.length; i++) {
				// Get the column schema and compute the column index.
				const columnIndex = columnIndices[i];
				const columnSchema = tableSchema.columns[i];

				// Update the column schema cache.
				this._columnSchemaCache.set(columnIndex, columnSchema);

				// YAYA
				// Update the column header width cache.
				if (this._columnHeaderWidthCalculator) {
					this._columnHeaderWidthCache.set(columnIndex, this._columnHeaderWidthCalculator(
						columnSchema.column_name,
						columnSchema.type_name
					));
				}
			}

			// Update the cache updated flag.
			cacheUpdated = true;
		}

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
				if (!this._dataColumnCache.get(columnIndex)?.get(rowIndex)) {
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
				// Get the row index.
				const rowIndex = rowIndices[row];

				// If row labels were returned, cache the row label for the row.
				if (tableData.row_labels) {
					const rowLabel = tableData.row_labels[0][row];
					this._rowLabelCache.set(rowIndex, rowLabel);
				}

				// Cache the data cells.
				for (let column = 0; column < columnIndices.length; column++) {
					// Get the column index, the row index, and the value.
					const columnIndex = columnIndices[column];
					const rowIndex = rowIndices[row];
					const value = tableData.columns[column][row];

					// Create the data cell.
					const dataCell = typeof value === 'number' ?
						decodeSpecialValue(value) :
						{
							kind: DataCellKind.NON_NULL,
							formatted: value
						};

					// Cache the data cell.
					const dataColumn = this._dataColumnCache.get(columnIndex);
					if (dataColumn) {
						dataColumn.set(rowIndex, dataCell);
					} else {
						this._dataColumnCache.set(
							columnIndex,
							new Map<number, DataCell>([[rowIndex, dataCell]])
						);
					}

					// Update the column value width cache.
					if (dataCell.formatted.length && this._columnValueWidthCalculator) {
						// Get the cached column value width and the column value width.
						const cachedColumnValueWidth = this._columnValueWidthCache.get(
							columnIndex
						);
						const columnValueWidth = this._columnValueWidthCalculator(
							dataCell.formatted.length
						);

						// Update the column value width cache as needed.
						if (!cachedColumnValueWidth ||
							columnValueWidth > cachedColumnValueWidth) {
							this._columnValueWidthCache.set(columnIndex, columnValueWidth);
						}
					}
				}
			}

			// Update the cache updated flag.
			cacheUpdated = true;
		}

		// If the cache was updated, fire the onDidUpdateCache event.
		if (cacheUpdated) {
			this._onDidUpdateCache.fire();
		}

		// Clear the updating flag.
		this._updating = false;

		// If there is a cache update descriptor, update the cache for it.
		if (this._pendingUpdateDescriptor) {
			// Get the pending cache update descriptor and clear it.
			const pendingCacheUpdateDescriptor = this._pendingUpdateDescriptor;
			this._pendingUpdateDescriptor = undefined;

			// Update the cache for the pending cache update descriptor.
			await this.updateCache(pendingCacheUpdateDescriptor);
		}
	}

	//#endregion Private Methods
}
