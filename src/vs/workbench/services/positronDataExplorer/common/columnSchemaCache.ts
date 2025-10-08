/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ColumnSchema } from '../../languageRuntime/common/positronDataExplorerComm.js';
import { DataExplorerClientInstance } from '../../languageRuntime/common/languageRuntimeDataExplorerClient.js';

/**
 * CacheUpdateDescriptor interface.
 */
interface CacheUpdateDescriptor {
	columnIndices: number[];
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
		// If there are no column indices, return.
		if (cacheUpdateDescriptor.columnIndices.length === 0) {
			return;
		}

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

		// Get the size of the data.
		const tableState = await this._dataExplorerClientInstance.getBackendState();
		this._columns = tableState.table_shape.num_columns;

		// Set the column indices of the column schema we need to load.
		const columnIndices = [];
		for (const index of cacheUpdateDescriptor.columnIndices) {
			if (!this._columnSchemaCache.has(index)) {
				columnIndices.push(index);
			}
		}

		// Load the column schema.
		const tableSchema = await this._dataExplorerClientInstance.getSchema(columnIndices);

		// Cache the column schema that was returned.
		for (const columnSchema of tableSchema.columns) {
			this._columnSchemaCache.set(columnSchema.column_index, columnSchema);
		}

		// Fire the onDidUpdateCache event.
		this._onDidUpdateCacheEmitter.fire();

		// Clear the updating cache flag.
		this._updatingCache = false;

		// If there is a pending cache update descriptor, update the cache for it.
		if (this._cacheUpdateDescriptor) {
			// Get the pending cache update descriptor and clear it.
			const pendingCacheUpdateDescriptor = this._cacheUpdateDescriptor;
			this._cacheUpdateDescriptor = undefined;

			// Update the cache for the pending cache update descriptor.
			await this.update(pendingCacheUpdateDescriptor);
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

}
