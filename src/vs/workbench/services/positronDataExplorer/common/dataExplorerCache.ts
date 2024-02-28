/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ColumnSchema, SchemaUpdateEvent } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';

/**
 * Constants.
 */
const OVERSCAN_FACTOR = 3;

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
	 * Gets the data explorer client instance.
	 */
	private readonly _dataExplorerClientInstance: DataExplorerClientInstance;

	/**
	 * Gets the column schema cache.
	 */
	private readonly _columnSchemaCache = new Map<number, ColumnSchema>();

	/**
	 * The onDidUpdate event emitter.
	 */
	protected readonly _onDidUpdateEmitter = this._register(new Emitter<void>);

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
		this._dataExplorerClientInstance.onDidSchemaUpdate(async (e: SchemaUpdateEvent) => {
			console.log('++++++++++++++++++++++ onDidSchemaUpdate!!');
			// // this._lastFetchedData = undefined;
			// this._lastFetchedSchema = undefined;

			// // Reset cursor to top left
			// // TODO: These attributes were made protected to allow this. Add a method to
			// // reset these without firing an update request which we don't want here yet.
			// this._firstColumnIndex = 0;
			// this._firstRowIndex = 0;

			// // Resets data schema, fetches initial schema and data
			// this.initialize();
		});

		// Add the onDidDataUpdate event handler.
		this._dataExplorerClientInstance.onDidDataUpdate(async () => {
			console.log('++++++++++++++++++++++ onDidDataUpdate!!');
			// this._lastFetchedData = undefined;
			// this._dataCache?.clear();
			// this.fetchData();
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
	 * onDidUpdate event.
	 */
	readonly onDidUpdate = this._onDidUpdateEmitter.event;

	//#endregion Public Events

	//#region Public Methods

	invalidateCache() {
		this._columnSchemaCache.clear();
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
		let tableSchema = await this._dataExplorerClientInstance.getSchema(0, 0);
		this._columns = tableSchema.total_num_columns;
		this._rows = tableSchema.num_rows;

		// Set the start column index and the end column index of the columns to cache.
		const startColumnIndex = Math.max(
			firstColumnIndex - (visibleColumns * OVERSCAN_FACTOR),
			0
		);
		const endColumnIndex = Math.min(
			startColumnIndex + visibleColumns + (visibleColumns * OVERSCAN_FACTOR * 2),
			this._columns - 1
		);

		// Build an array of the column schema indexes that need to be cached.
		const columnSchemaIndexes: number[] = [];
		for (let columnIndex = startColumnIndex; columnIndex <= endColumnIndex; columnIndex++) {
			if (!this._columnSchemaCache.has(columnIndex)) {
				columnSchemaIndexes.push(columnIndex);
			}
		}

		// If there are column schema indexes that need to be cached, cache them.
		if (columnSchemaIndexes.length) {
			// It would be ideal to be able to pass an array of column schema indexes into getSchema
			// here, but this is not how it works. Instead, we call getSchema to get every column
			// between the first index and the last index.
			tableSchema = await this._dataExplorerClientInstance.getSchema(
				columnSchemaIndexes[0],
				columnSchemaIndexes[columnSchemaIndexes.length - 1] - columnSchemaIndexes[0] + 1
			);

			// Update the column schema cache, overwriting any entries we already have cached.
			for (let i = 0; i < tableSchema.columns.length; i++) {
				this._columnSchemaCache.set(columnSchemaIndexes[0] + i, tableSchema.columns[i]);
			}
		}

		// If the cache changed, fire the onDidUpdate event.
		if (columnSchemaIndexes.length || columnSchemaIndexes.length) {
			this._onDidUpdateEmitter.fire();
		}
	}

	getColumn(columnIndex: number) {
		return this._columnSchemaCache.get(columnIndex);
	}

	//#endregion Public Methods
}

