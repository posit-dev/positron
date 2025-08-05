/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ColumnSchema } from '../../languageRuntime/common/positronDataExplorerComm.js';
import { DataExplorerClientInstance } from '../../languageRuntime/common/languageRuntimeDataExplorerClient.js';

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
 * CacheUpdateDescriptor interface.
 */
interface CacheUpdateDescriptor {
	searchText?: string;
	firstColumnIndex: number;
	visibleColumns: number;
}

/**
 * ColumnSchemaCache class.
 */
export class ColumnSchemaCache extends Disposable {
	//#region Private Properties

	/**
	 * Gets or sets a value which indicates whether the cache is being updated.
	 */
	private _updatingCache = false;

	/**
	 * Gets or sets the cache update descriptor.
	 */
	private _cacheUpdateDescriptor?: CacheUpdateDescriptor;

	/**
	 * The search text.
	 */
	private _searchText?: string;

	/**
	 * Gets or sets the columns.
	 */
	private _columns = 0;

	/**
	 * Gets the column schema cache.
	 */
	private readonly _columnSchemaCache = new Map<number, ColumnSchema>();

	/**
	 * The onDidUpdateCache event emitter.
	 */
	protected readonly _onDidUpdateCacheEmitter = this._register(new Emitter<void>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _dataExplorerClientInstance The data explorer client instance.
	 */
	constructor(private readonly _dataExplorerClientInstance: DataExplorerClientInstance) {
		// Call the base class's constructor.
		super();

		// Add the onDidSchemaUpdate event handler.
		this._register(this._dataExplorerClientInstance.onDidSchemaUpdate(async () =>
			// Clear the column schema cache.
			this._columnSchemaCache.clear()
		));
	}

	//#endregion Constructor & Dispose

	//#region Public Properties

	/**
	 * Gets the columns.
	 */
	get columns() {
		return this._columns;
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
	 * Updates the cache.
	 * @param cacheUpdateDescriptor The cache update descriptor.
	 * @returns A Promise<void> that resolves when the update is complete.
	 */
	async update(cacheUpdateDescriptor: CacheUpdateDescriptor): Promise<void> {
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

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Updates the cache.
	 * @param cacheUpdateDescriptor The cache update descriptor.
	 */
	private async doUpdateCache(cacheUpdateDescriptor: CacheUpdateDescriptor): Promise<void> {
		// If a cache update is already in progress, set the pending cache update descriptor and
		// return. This allows cache updates that are happening in rapid succession to overwrite one
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
			searchText,
			firstColumnIndex,
			visibleColumns,
		} = cacheUpdateDescriptor;

		// If the search text has changed, clear the column schema cache.
		if (searchText !== this._searchText) {
			this._columnSchemaCache.clear();
		}

		this._searchText = searchText;

		// // Get the size of the data.
		// const tableState = await this._dataExplorerClientInstance.getBackendState();
		// this._columns = tableState.table_shape.num_columns;

		// Set the start column index and the end column index of the columns to cache.
		const startColumnIndex = Math.max(
			firstColumnIndex - (visibleColumns * OVERSCAN_FACTOR),
			0
		);
		const endColumnIndex = startColumnIndex +
			visibleColumns +
			(visibleColumns * OVERSCAN_FACTOR * 2);

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
			const tableSchemaSearchResult = await this._dataExplorerClientInstance.searchSchema({
				searchText,
				startIndex: columnSchemaIndices[0],
				numColumns: columnSchemaIndices[columnSchemaIndices.length - 1] -
					columnSchemaIndices[0] + 1
			});

			// Set the columns.
			this._columns = tableSchemaSearchResult.matching_columns;

			// Update the column schema cache, overwriting any entries we already have cached.
			for (let i = 0; i < tableSchemaSearchResult.columns.length; i++) {
				this._columnSchemaCache.set(columnSchemaIndices[0] + i, tableSchemaSearchResult.columns[i]);
			}

			// Update the cache updated flag.
			cacheUpdated = true;
		}

		// If the cache was updated, fire the onDidUpdateCache event.
		if (cacheUpdated) {
			this._onDidUpdateCacheEmitter.fire();
		}

		// Clear the updating cache flag.
		this._updatingCache = false;

		// If there is a pending cache update descriptor, update the cache for it.
		if (this._cacheUpdateDescriptor) {
			// Get the pending cache update descriptor and clear it.
			const pendingCacheUpdateDescriptor = this._cacheUpdateDescriptor;
			this._cacheUpdateDescriptor = undefined;

			// Update the cache for the pending cache update descriptor.
			await this.doUpdateCache(pendingCacheUpdateDescriptor);
		}
	}

	//#endregion Private Methods
}
