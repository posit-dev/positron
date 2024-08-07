/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { arrayFromIndexRange } from 'vs/workbench/services/positronDataExplorer/common/utils';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { ColumnProfileRequest, ColumnProfileResult, ColumnProfileSpec, ColumnProfileType, ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

/**
 * Constants.
 */
const TRIM_CACHE_TIMEOUT = 3000;
const OVERSCAN_FACTOR = 3;

/**
 * UpdateDescriptor interface.
 */
interface UpdateDescriptor {
	invalidateCache: boolean;
	firstColumnIndex: number;
	screenColumns: number;
}

/**
 * TableSummaryCache class.
 */
export class TableSummaryCache extends Disposable {
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
	 * Gets the expanded columns set.
	 */
	private readonly _expandedColumns = new Set<number>();

	/**
	 * Gets the column schema cache.
	 */
	private readonly _columnSchemaCache = new Map<number, ColumnSchema>();

	/**
	 * Gets the column profile.
	 */
	private readonly _columnProfileCache = new Map<number, ColumnProfileResult>();

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
	 * Returns a value which indicates whether the specified column index is expanded.
	 * @param columnIndex The columm index.
	 * @returns A value which indicates whether the specified column index is expanded.
	 */
	isColumnExpanded(columnIndex: number) {
		return this._expandedColumns.has(columnIndex);
	}

	/**
	 * Toggles the expanded state of the specified column index.
	 * @param columnIndex The columm index.
	 */
	async toggleExpandColumn(columnIndex: number) {
		// If the column is expanded, collpase it, fire the onDidUpdate event, and return.
		if (this._expandedColumns.has(columnIndex)) {
			this._expandedColumns.delete(columnIndex);
			this._onDidUpdateEmitter.fire();
			return;
		}

		// Expand the column.
		this._expandedColumns.add(columnIndex);

		// If we already have summary stats for the column, fire the onDidUpdate event and return.
		if (this._columnProfileCache.get(columnIndex)?.summary_stats) {
			this._onDidUpdateEmitter.fire();
			return;
		}

		// Get the summary stats for the newly expanded column.
		const columnProfileResults = await this._dataExplorerClientInstance.getColumnProfiles([({
			column_index: columnIndex,
			profiles: [{ profile_type: ColumnProfileType.SummaryStats }]
		})]);

		// Update the column profile.
		if (columnProfileResults.length === 1) {
			const columnProfile = this._columnProfileCache.get(columnIndex);
			if (columnProfile) {
				columnProfile.summary_stats = columnProfileResults[0].summary_stats;
				this._onDidUpdateEmitter.fire();
			}
		}
	}

	/**
	 * Updates the cache.
	 * @param updateDescriptor The update descriptor.
	 */
	async update(updateDescriptor: UpdateDescriptor): Promise<void> {
		// Clear the trim cache timeout.
		this.clearTrimCacheTimeout();

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
			invalidateCache,
			firstColumnIndex,
			screenColumns
		} = updateDescriptor;

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
			firstColumnIndex + screenColumns + overscanColumns
		);

		// Set the column indices of the column schema we need to load.
		let columnIndices: number[];
		if (invalidateCache) {
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

		// Invalidate the cache, if we're supposed to.
		if (invalidateCache) {
			this._columnSchemaCache.clear();
			this._columnProfileCache.clear();
		}

		// Cache the column schema that was returned.
		for (let i = 0; i < tableSchema.columns.length; i++) {
			this._columnSchemaCache.set(columnIndices[i], tableSchema.columns[i]);
		}

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();

		// Load the column profiles.
		const columnProfiles = await this._dataExplorerClientInstance.getColumnProfiles(
			columnIndices.map((column_index): ColumnProfileRequest => {
				// Build the array of column profiles to load.
				const profiles: ColumnProfileSpec[] = [
					{ profile_type: ColumnProfileType.NullCount }
				];
				if (this._expandedColumns.has(column_index)) {
					profiles.push({ profile_type: ColumnProfileType.SummaryStats });
				}

				// Return the column profile request.
				return { column_index, profiles };
			})
		);

		// Cache the column profiles that were returned.
		for (let i = 0; i < columnProfiles.length; i++) {
			this._columnProfileCache.set(columnIndices[i], columnProfiles[i]);
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
		if (!invalidateCache) {
			// Set the trim cache timeout.
			this._trimCacheTimeout = setTimeout(() => {
				// Release the trim cache timeout.
				this._trimCacheTimeout = undefined;

				// Trim the cache.
				this.trimCache(startColumnIndex, endColumnIndex);
			}, TRIM_CACHE_TIMEOUT);
		}
	}

	/**
	 * Refreshes the column profile cache.
	 */
	async refreshColumnProfiles(): Promise<void> {
		// Get the size of the data.
		const tableState = await this._dataExplorerClientInstance.getBackendState();
		this._columns = tableState.table_shape.num_columns;
		this._rows = tableState.table_shape.num_rows;

		// Get the sorted column indicies so we can build the column profile requests in order.
		const columnIndices = [...this._columnProfileCache.keys()].sort((a, b) => a - b);

		// Build the column profile requests.
		const columnProfileRequests: ColumnProfileRequest[] = [];
		for (const columnIndex of columnIndices) {
			// Get the column profile.
			const columnProfile = this._columnProfileCache.get(columnIndex);
			if (columnProfile) {
				// Build the profiles. Always ask for the null count.
				const columnProfileSpecs: ColumnProfileSpec[] = [
					{ profile_type: ColumnProfileType.NullCount }
				];

				// Add summary stats.
				if (columnProfile.summary_stats) {
					columnProfileSpecs.push({ profile_type: ColumnProfileType.SummaryStats });
				}

				// Add histogram.
				if (columnProfile.histogram) {
					columnProfileSpecs.push({ profile_type: ColumnProfileType.Histogram });
				}

				// Add frequency table.
				if (columnProfile.frequency_table) {
					columnProfileSpecs.push({ profile_type: ColumnProfileType.FrequencyTable });
				}

				// Add the column profile request.
				columnProfileRequests.push({
					column_index: columnIndex,
					profiles: columnProfileSpecs
				});
			}
		}

		// Get the column profiles.
		const columnProfileResults = await this._dataExplorerClientInstance.getColumnProfiles(
			columnProfileRequests
		);

		// Refresh the column profile cache with the column profiles.
		for (let i = 0; i < columnIndices.length && i < columnProfileRequests.length; i++) {
			this._columnProfileCache.set(columnIndices[i], columnProfileResults[i]);
		}

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();
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
	 * Gets the column profile for the specified column index.
	 * @param columnIndex The column index.
	 * @returns The column profile for the specified column index.
	 */
	getColumnProfile(columnIndex: number) {
		return this._columnProfileCache.get(columnIndex);
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
	 * Trims the cache.
	 * @param startColumnIndex The start column index.
	 * @param endColumnIndex The end column index.
	 */
	private trimCache(startColumnIndex: number, endColumnIndex: number) {
		// Trim the column schema cache.
		for (const columnIndex of this._columnSchemaCache.keys()) {
			if (columnIndex < startColumnIndex || columnIndex > endColumnIndex) {
				this._columnSchemaCache.delete(columnIndex);
			}
		}

		// Trim the column profile cache.
		for (const columnIndex of this._columnProfileCache.keys()) {
			if (columnIndex < startColumnIndex || columnIndex > endColumnIndex) {
				this._columnProfileCache.delete(columnIndex);
			}
		}
	}

	//#endregion Private Methods
}
