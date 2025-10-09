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
const TRIM_CACHE_TIMEOUT = 3000; // 3 seconds

/**
 * CacheUpdateDescriptor interface.
 */
interface CacheUpdateDescriptor {
	columnIndices: number[];
	invalidateCache: boolean;
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
	private _pendingCacheUpdateDescriptor?: CacheUpdateDescriptor;

	/**
	 * Gets or sets the trim cache timeout.
	 */
	private _trimCacheTimeout?: Timeout;

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
	 * Updates the cache with the specified column indices.
	 * @param param0 The column indices.
	 * @returns A Promise<void> that resolves when the update is complete.
	 */
	async update(cacheUpdateDescriptor: CacheUpdateDescriptor): Promise<void> {
		// Clear the trim cache timeout.
		this.clearTrimCacheTimeout();

		// If there are no column indices, return.
		if (cacheUpdateDescriptor.columnIndices.length === 0) {
			return;
		}

		// If a cache update is already in progress, set the pending cache update descriptor and
		// return. This allows cache updates that are happening in rapid succession to overwrite one
		// another so that only the last one gets processed. (For example, this happens when a user
		// drags a scrollbar rapidly.)
		if (this._updatingCache) {
			this._pendingCacheUpdateDescriptor = cacheUpdateDescriptor;
			return;
		}

		// Set the updating cache flag.
		this._updatingCache = true;

		// Get the size of the data.
		const tableState = await this._dataExplorerClientInstance.getBackendState();
		this._columns = tableState.table_shape.num_columns;

		// Set the column indices of the column schema we need to load.
		let columnIndices: number[];
		if (cacheUpdateDescriptor.invalidateCache) {
			columnIndices = cacheUpdateDescriptor.columnIndices;
		} else {
			columnIndices = [];
			for (const index of cacheUpdateDescriptor.columnIndices) {
				if (!this._columnSchemaCache.has(index)) {
					columnIndices.push(index);
				}
			}
		}

		// Load the column schema.
		const tableSchema = await this._dataExplorerClientInstance.getSchema(columnIndices);

		// Invalidate the cache, if we're supposed to.
		if (cacheUpdateDescriptor.invalidateCache) {
			this._columnSchemaCache.clear();
		}

		// Cache the column schema that was returned.
		for (const columnSchema of tableSchema.columns) {
			this._columnSchemaCache.set(columnSchema.column_index, columnSchema);
		}

		// Fire the onDidUpdateCache event.
		this._onDidUpdateCacheEmitter.fire();

		// Clear the updating cache flag.
		this._updatingCache = false;

		// If there is a pending cache update descriptor, update the cache for it.
		if (this._pendingCacheUpdateDescriptor) {
			// Get the pending cache update descriptor and clear it.
			const pendingCacheUpdateDescriptor = this._pendingCacheUpdateDescriptor;
			this._pendingCacheUpdateDescriptor = undefined;

			// Update the cache for the pending cache update descriptor.
			await this.update(pendingCacheUpdateDescriptor);
		}

		// Schedule trimming the cache if we have actual column indices to preserve.
		// This prevents accidentally clearing all cached data when columnIndices is an empty array
		// which happens during UI state transitions (e.g. during resizing when layoutHeight is 0).
		if (!cacheUpdateDescriptor.invalidateCache && columnIndices.length) {
			// Set the trim cache timeout.
			this._trimCacheTimeout = setTimeout(() => {
				// Release the trim cache timeout.
				this._trimCacheTimeout = undefined;
				// Trim the cache.
				this.trimCache(new Set(columnIndices));
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
	 * Trims the data in the cache if the key is not in the provided list.
	 * @param columnIndicesToKeep The array of column indices to keep in the cache.
	 */
	private trimCache(columnIndices: Set<number>) {
		// Trim the column schema cache.
		for (const columnIndex of this._columnSchemaCache.keys()) {
			if (!columnIndices.has(columnIndex)) {
				this._columnSchemaCache.delete(columnIndex);
			}
		}
	}

	//#endregion Private Methods
}
