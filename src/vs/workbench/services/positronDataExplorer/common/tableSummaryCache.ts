/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { DataExplorerClientInstance } from '../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { ColumnDisplayType, ColumnHistogramParamsMethod, ColumnProfileRequest, ColumnProfileResult, ColumnProfileSpec, ColumnProfileType, ColumnSchema, SupportStatus } from '../../languageRuntime/common/positronDataExplorerComm.js';

/**
 * Constants.
 */
const TRIM_CACHE_TIMEOUT = 3000;
const SMALL_HISTOGRAM_NUM_BINS = 80;
const LARGE_HISTOGRAM_NUM_BINS = 200;
const SMALL_FREQUENCY_TABLE_LIMIT = 8;
const LARGE_FREQUENCY_TABLE_LIMIT = 16;
const UPDATE_EVENT_DEBOUNCE_DELAY = 50;

/**
 * UpdateDescriptor interface.
 */
interface UpdateDescriptor {
	invalidateCache: boolean;
	columnIndices: number[];
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
	private _trimCacheTimeout?: Timeout;

	/**
	 * Gets or sets the debounced update event timeout.
	 */
	private _debouncedUpdateTimeout?: Timeout;

	/**
	 * Gets or sets the columns.
	 */
	private _columns = 0;

	/**
	 * Gets or sets the rows.
	 */
	private _rows = 0;

	/**
	 * The expanded columns set is used to track which columns are expanded
	 * in the summary data grid. This allows the data grid to only fetch
	 * the summary data for columns as they are expanded to avoid
	 * unnecessary data fetching and improve rendering performance.
	 */
	private readonly _expandedColumns = new Set<number>();

	/**
	 * A map of the column metadata where the key is the column index
	 * of the column from the original dataset.
	 *
	 * A key of 0 refers to the first column of the data.
	 * A key of 1 refers to the second column of the data.
	 * A key of N refers to the Nth+1 column of the data.
	 */
	private readonly _columnSchemaCache = new Map<number, ColumnSchema>();

	/**
	 * A map of the column summary data where the key is the column index
	 * of the column from the original dataset.
	 *
	 * A key of 0 refers to the first column of the data.
	 * A key of 1 refers to the second column of the data.
	 * A key of N refers to the Nth+1 column of the data.
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
	constructor(
		private readonly _dataExplorerClientInstance: DataExplorerClientInstance
	) {
		// Call the base class's constructor.
		super();
	}

	/**
	 * Dispose method.
	 */
	public override dispose(): void {
		// Clear the trim cache timeout.
		this.clearTrimCacheTimeout();

		// Clear the debounced update timeout.
		this.clearDebouncedUpdateTimeout();

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
	 * @param columnIndex The column index.
	 * @returns A value which indicates whether the specified column index is expanded.
	 */
	isColumnExpanded(columnIndex: number) {
		// With the layout manager integration, columnIndex should be the original column index
		return this._expandedColumns.has(columnIndex);
	}

	/**
	 * Toggles the expanded state of the specified column index.
	 * @param columnIndex The column index.
	 */
	async toggleExpandColumn(columnIndex: number) {
		// If the column is expanded, collapse it, fire the onDidUpdate event, and return.
		if (this._expandedColumns.has(columnIndex)) {
			this._expandedColumns.delete(columnIndex);
			this._onDidUpdateEmitter.fire();
			return;
		}

		// Otherewise, expand it, fire the onDidUpdate event, and fetch the column profile data.
		this._expandedColumns.add(columnIndex);
		this._onDidUpdateEmitter.fire();
		await this.updateColumnProfileCache([columnIndex]);
	}

	/**
	 * Updates the cache.
	 * @param updateDescriptor The update descriptor.
	 */
	async update(updateDescriptor: UpdateDescriptor): Promise<void> {
		// Clear the trim cache timeout.
		this.clearTrimCacheTimeout();

		// If we have empty column indices and we're not invalidating the cache, skip the update.
		// This can happen during UI state transitions (like resizing) when layoutHeight is 0.
		if (updateDescriptor.columnIndices.length === 0 && !updateDescriptor.invalidateCache) {
			return;
		}

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

		// Get the size of the data.
		const tableState = await this._dataExplorerClientInstance.getBackendState();
		this._columns = tableState.table_shape.num_columns;
		this._rows = tableState.table_shape.num_rows;

		// Set the column indices of the column schema we need to load.
		let columnIndices: number[];
		if (updateDescriptor.invalidateCache) {
			columnIndices = updateDescriptor.columnIndices;
		} else {
			columnIndices = [];
			for (const index of updateDescriptor.columnIndices) {
				if (!this._columnSchemaCache.has(index)) {
					columnIndices.push(index);
				}
			}
		}

		// Load the column schema.
		const tableSchema = await this._dataExplorerClientInstance.getSchema(columnIndices);

		// Invalidate the cache, if we're supposed to.
		if (updateDescriptor.invalidateCache) {
			this._columnSchemaCache.clear();
			this._columnProfileCache.clear();
		}

		// Cache the column schema that was returned.
		for (const columnSchema of tableSchema.columns) {
			this._columnSchemaCache.set(columnSchema.column_index, columnSchema);
		}

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();

		// Update the column profile cache.
		await this.updateColumnProfileCache(columnIndices);

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

		// Schedule trimming the cache if we have actual column indices to preserve.
		// This prevents accidentally clearing all cached data when columnIndices is an empty array
		// which happens during UI state transitions (e.g. during resizing when layoutHeight is 0).
		if (!updateDescriptor.invalidateCache && columnIndices.length) {
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
	 * Refreshes the column profile cache.
	 */
	async refreshColumnProfiles(): Promise<void> {
		// Get the size of the data.
		const tableState = await this._dataExplorerClientInstance.getBackendState();
		this._columns = tableState.table_shape.num_columns;
		this._rows = tableState.table_shape.num_rows;

		// Update the column profile cache.
		await this.updateColumnProfileCache(
			[...this._columnProfileCache.keys()].sort((a, b) => a - b)
		);
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
	 * Updates the column profile cache for the specified column indices.
	 * @param columnIndices The column indices.
	 */
	private async updateColumnProfileCache(columnIndices: number[]) {
		// Determne whether histograms and frequency tables are supported.
		const histogramSupported = this.isHistogramSupported();
		const frequencyTableSupported = this.isFrequencyTableSupported();

		const columnRequests = columnIndices.map((column_index): ColumnProfileRequest => {
			// Get the column schema.
			const columnSchema = this._columnSchemaCache.get(column_index);

			// Build the array of column profiles to load. Always load the null count.
			const profiles: ColumnProfileSpec[] = [{
				profile_type: ColumnProfileType.NullCount
			}];

			// Determine whether the column is expanded.
			const columnExpanded = this._expandedColumns.has(column_index);

			// If the column is expanded, load the summary stats.
			if (columnExpanded) {
				profiles.push({ profile_type: ColumnProfileType.SummaryStats });
			}

			// Determine whether to load the histogram or the frequency table for the column.
			switch (columnSchema?.type_display) {
				// Number (including all numeric subtypes).
				case ColumnDisplayType.Number:
				case ColumnDisplayType.Floating:
				case ColumnDisplayType.Integer:
				case ColumnDisplayType.Decimal: {
					// If histograms are supported, load them.
					if (histogramSupported) {
						// Load the small histogram.
						profiles.push({
							profile_type: ColumnProfileType.SmallHistogram,
							params: {
								method: ColumnHistogramParamsMethod.FreedmanDiaconis,
								num_bins: SMALL_HISTOGRAM_NUM_BINS,
							}
						});

						// If the column is expanded, load the large histogram.
						if (columnExpanded) {
							profiles.push({
								profile_type: ColumnProfileType.LargeHistogram,
								params: {
									method: ColumnHistogramParamsMethod.FreedmanDiaconis,
									num_bins: LARGE_HISTOGRAM_NUM_BINS,
								}
							});
						}
					}
					break;
				}

				// Boolean.
				case ColumnDisplayType.Boolean: {
					// If frequency tables are supported, load them.
					if (frequencyTableSupported) {
						// Load the small frequency table. Note that we do not load the large
						// frequency table because there are only two possible values.
						profiles.push({
							profile_type: ColumnProfileType.SmallFrequencyTable,
							params: {
								limit: 2
							}
						});

					}
					break;
				}

				// String.
				case ColumnDisplayType.String: {
					// If frequency tables are supported, load them.
					if (frequencyTableSupported) {
						// Load the small frequency table.
						profiles.push({
							profile_type: ColumnProfileType.SmallFrequencyTable,
							params: {
								limit: SMALL_FREQUENCY_TABLE_LIMIT
							}
						});

						// If the column is expanded, load the large frequency table.
						if (columnExpanded) {
							profiles.push({
								profile_type: ColumnProfileType.LargeFrequencyTable,
								params: {
									limit: LARGE_FREQUENCY_TABLE_LIMIT
								}
							});
						}
					}
					break;
				}
			}

			// Return the column profile request.
			return { column_index, profiles };
		});

		const tableState = await this._dataExplorerClientInstance.getBackendState();

		// For more than 1 million rows, we request profiles one by one rather than as a batch for
		// better responsiveness
		const BATCHING_THRESHOLD = 1_000_000;
		if (tableState.table_shape.num_rows > BATCHING_THRESHOLD) {
			// Start all requests and store promises
			const profilePromises = columnRequests.map((columnRequest, index) => {
				const columnIndex = columnIndices[index];

				// Start the request and handle result immediately when it completes
				const promise = this._dataExplorerClientInstance.getColumnProfiles([columnRequest])
					.then(results => {
						// Cache the result as soon as it's available
						if (results.length > 0) {
							this._columnProfileCache.set(columnIndex, results[0]);
						}
						// Fire the onDidUpdate event with debouncing for smoother updates
						this.fireOnDidUpdateDebounced();
						return results;
					})
					.catch(error => {
						// Handle errors gracefully
						console.error(`Failed to get column profile for index ${columnIndex}:`, error);
						throw error;
					});

				return promise;
			});

			// Wait for all requests to complete
			await Promise.allSettled(profilePromises);
		} else {
			// Load the column profiles as a batch
			const columnProfileResults = await this._dataExplorerClientInstance.getColumnProfiles(
				columnRequests
			);
			// Cache the column profiles that were returned.
			for (let i = 0; i < columnProfileResults.length; i++) {
				this._columnProfileCache.set(columnIndices[i], columnProfileResults[i]);
			}
			// Fire the onDidUpdate event.
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Determines whether histograms are supported.
	 * @returns true if histograms are supported; otherwise, false.
	 */
	private isHistogramSupported() {
		const columnProfilesFeatures = this._dataExplorerClientInstance.getSupportedFeatures()
			.get_column_profiles;
		const histogramSupportStatus = columnProfilesFeatures.supported_types.find(status =>
			status.profile_type === ColumnProfileType.SmallHistogram
		);

		if (!histogramSupportStatus) {
			return false;
		}

		return histogramSupportStatus.support_status === SupportStatus.Supported;
	}

	/**
	 * Determines whether frequency tables are supported.
	 * @returns true if frequency tables are supported; otherwise, false.
	 */
	private isFrequencyTableSupported() {
		const columnProfilesFeatures = this._dataExplorerClientInstance.getSupportedFeatures()
			.get_column_profiles;
		const frequencyTableSupportStatus = columnProfilesFeatures.supported_types.find(status =>
			status.profile_type === ColumnProfileType.SmallFrequencyTable
		);

		if (!frequencyTableSupportStatus) {
			return false;
		}

		return frequencyTableSupportStatus.support_status === SupportStatus.Supported;
	}

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
	 * Clears the debounced update timeout.
	 */
	private clearDebouncedUpdateTimeout() {
		// If there is a debounced update timeout scheduled, clear it.
		if (this._debouncedUpdateTimeout) {
			clearTimeout(this._debouncedUpdateTimeout);
			this._debouncedUpdateTimeout = undefined;
		}
	}

	/**
	 * Fires the onDidUpdate event with debouncing to smooth incremental updates.
	 */
	private fireOnDidUpdateDebounced() {
		// Clear any existing debounced update timeout.
		this.clearDebouncedUpdateTimeout();

		// Set a new debounced update timeout.
		this._debouncedUpdateTimeout = setTimeout(() => {
			this._debouncedUpdateTimeout = undefined;
			this._onDidUpdateEmitter.fire();
		}, UPDATE_EVENT_DEBOUNCE_DELAY);
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

		// Trim the column profile cache.
		for (const columnIndex of this._columnProfileCache.keys()) {
			if (!columnIndices.has(columnIndex)) {
				this._columnProfileCache.delete(columnIndex);
			}
		}
	}

	//#endregion Private Methods
}
