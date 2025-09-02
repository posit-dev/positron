/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { arrayFromIndexRange } from './utils.js';
import { DataExplorerClientInstance } from '../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { dataExplorerExperimentalFeatureEnabled } from './positronDataExplorerExperimentalConfig.js';
import { ColumnDisplayType, ColumnHistogramParamsMethod, ColumnProfileRequest, ColumnProfileResult, ColumnProfileSpec, ColumnProfileType, ColumnSchema, SearchSchemaSortOrder, SearchSchemaResult } from '../../languageRuntime/common/positronDataExplorerComm.js';
import { summaryPanelEnhancementsFeatureEnabled } from './positronDataExplorerSummaryEnhancementsFeatureFlag.js';

/**
 * Constants.
 */
const TRIM_CACHE_TIMEOUT = 3000;
const OVERSCAN_FACTOR = 3;
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
	searchText?: string;
	sortOption?: SearchSchemaSortOrder;
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
	private _trimCacheTimeout?: Timeout;

	/**
	 * Gets or sets the debounced update event timeout.
	 */
	private _debouncedUpdateTimeout?: Timeout;

	/**
	 * The search text used to filter the dataset in the column schema
	 * and column profile caches. The last search text value is maintained
	 * to avoid unnecessary cache updates when the search text has not changed.
	 */
	private _searchText?: string;

	/**
	 * The sort option used to order the summary rows.
	 */
	private _sortOption?: SearchSchemaSortOrder;

	/**
	 * Gets or sets the columns.
	 */
	private _columns = 0;

	/**
	 * Gets or sets the rows.
	 */
	private _rows = 0;

	/**
	 * An array that maps a position index in the data grid to a column index for the original dataset.
	 * This array is always populated and serves as the single source of truth for determining the
	 * display position and order of the summary rows.
	 *
	 * For un-modified datasets: [0, 1, 2, 3, 4, ...] (position and column index are the same)
	 * For search or sort results: [0, 5, 12, 25, ...] (position and column index may differ)
	 *
	 * _displayPositionOrder[0] = 5 means the first row in the data grid should display data
	 * for the 6th column (index 5) from the original un-modified dataset.
	 */
	private _displayPositionOrder: number[] = [];

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
	 * @param _configurationService The configuration service.
	 * @param _dataExplorerClientInstance The data explorer client instance.
	 */
	constructor(
		private readonly _configurationService: IConfigurationService,
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

	/**
	 * Gets the display position order array.
	 * This array maps display positions to original column indices.
	 */
	get displayPositionOrder() {
		return this._displayPositionOrder;
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
	 * Returns a value which indicates whether the specified display index is expanded.
	 * @param displayIndex The display position index for the column.
	 * @returns A value which indicates whether the specified display index is expanded.
	 */
	isColumnExpanded(displayIndex: number) {
		const originalIndex = summaryPanelEnhancementsFeatureEnabled(this._configurationService)
			? this._displayPositionOrder[displayIndex]
			: displayIndex;

		return originalIndex !== undefined ? this._expandedColumns.has(originalIndex) : false;
	}

	/**
	 * Toggles the expanded state of the specified display index.
	 * @param displayIndex The display position index for the column.
	 */
	async toggleExpandColumn(displayIndex: number) {
		// Convert display index to original column index.
		const originalIndex = summaryPanelEnhancementsFeatureEnabled(this._configurationService)
			? this._displayPositionOrder[displayIndex]
			: displayIndex;

		if (originalIndex === undefined) {
			return;
		}

		// If the column is expanded, collpase it, fire the onDidUpdate event, and return.
		if (this._expandedColumns.has(originalIndex)) {
			this._expandedColumns.delete(originalIndex);
			this._onDidUpdateEmitter.fire();
			return;
		}

		// Expand the column.
		this._expandedColumns.add(originalIndex);

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();

		// Update the column profile cache.
		await this.updateColumnProfileCache([originalIndex]);
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

		// Schedule trimming the cache.
		if (!invalidateCache) {
			// Set the trim cache timeout.
			this._trimCacheTimeout = setTimeout(() => {
				// Release the trim cache timeout.
				this._trimCacheTimeout = undefined;

				// Trim the cache.
				this.trimCache(arrayFromIndexRange(startColumnIndex, endColumnIndex));
			}, TRIM_CACHE_TIMEOUT);
		}
	}

	/**
	 * New update method that supports search and sort work being done
	 * behind the USE_DATA_EXPLORER_SUMMARY_PANEL_ENHANCEMENTS_KEY setting
	 * @param updateDescriptor The update descriptor containing the new search and sort parameters
	 */
	async update2(updateDescriptor: UpdateDescriptor): Promise<void> {
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
			searchText,
			sortOption,
			firstColumnIndex,
			screenColumns
		} = updateDescriptor;

		this._searchText = searchText;
		this._sortOption = sortOption;

		// Get the size of the data.
		const tableState = await this._dataExplorerClientInstance.getBackendState();
		this._columns = tableState.table_shape.num_columns;
		this._rows = tableState.table_shape.num_rows;

		// The overscan factor determines how many additional columns to cache
		// to ensure smooth scrolling and rendering. Considered to be part of
		// the data that is viewable.
		const overscanColumns = screenColumns * OVERSCAN_FACTOR;
		// Determine the first column index to start caching from.
		const startColumnIndex = Math.max(
			0,
			firstColumnIndex - overscanColumns
		);
		// Determines the minimum number of columns we need to cache
		// to fill the screen (including overscan).
		const endColumnIndex = Math.min(
			tableState.table_shape.num_columns - 1,
			firstColumnIndex + screenColumns + overscanColumns
		);

		// the indices of the column that we need to fetch data for and then cache
		let columnIndices: number[] = [];
		// the search/sort results from the backend
		let searchResult: SearchSchemaResult | undefined = undefined;
		// Variables to track the viewable start and end indices when search/sort is present
		let viewableStartIndex: number | undefined = undefined;
		let viewableEndIndex: number | undefined = undefined;

		// When search text or sort options is present, we always need to get the full sorted order first
		if (this._searchText || this._sortOption) {
			// Use the new search method that supports backend search and sort
			searchResult = await this._dataExplorerClientInstance.searchSchema2({
				searchText: this._searchText,
				sortOption: this._sortOption,
			});
		}

		// Determine what columns we need to fetch data for and then store in cache
		if (searchResult && searchResult.matches.length > 0) {
			// For sorted/searched results, calculate viewable columns within the search/sort results
			viewableStartIndex = Math.max(0, firstColumnIndex - overscanColumns);
			viewableEndIndex = Math.min(
				searchResult.matches.length - 1,
				firstColumnIndex + screenColumns + overscanColumns
			);
			const viewableColumns = searchResult.matches.slice(viewableStartIndex, viewableEndIndex + 1);

			// If the cache is invalidated we will need to load all the columns in view into
			// the cache again otherwise, we just need the missing columns should be in view.
			// The cache will be updated with the data for the columns in `columnIndices`
			columnIndices = invalidateCache
				? viewableColumns
				: viewableColumns.filter(columnIndex => !this._columnSchemaCache.has(columnIndex));
		} else if (!searchResult || searchResult.matches.length === 0) {
			// No search results, which means we have nothing to cache
			columnIndices = [];
		} else {
			const viewableColumns = arrayFromIndexRange(startColumnIndex, endColumnIndex);
			if (invalidateCache) {
				// No search/sort, so we need indices of all columns in viewable range
				// since we're clearing and replacing the caches
				columnIndices = viewableColumns;
			} else {
				// No search/sort, get all column indices in viewable range that aren't already cached
				columnIndices = viewableColumns.filter(columnIndex => !this._columnSchemaCache.has(columnIndex));
			}
		}

		// Update cache and display order based on the columns we need data for
		if (searchResult) {
			if (searchResult.matches.length > 0) {
				// Calculate viewable columns within within search/sort results
				const viewportStartIndex = Math.max(0, firstColumnIndex - overscanColumns);
				const viewportEndIndex = Math.min(
					searchResult.matches.length - 1,
					firstColumnIndex + screenColumns + overscanColumns
				);

				// Get the column indices of the viewable columns
				const viewableColumns = searchResult.matches.slice(viewportStartIndex, viewportEndIndex + 1);

				// Fetch schema for any columns we need to load
				if (columnIndices.length > 0) {
					const tableSchema = await this._dataExplorerClientInstance.getSchema(columnIndices);

					// Clear cache if invalidating to avoid stale data
					if (invalidateCache) {
						this._columnSchemaCache.clear();
						this._columnProfileCache.clear();
					}

					// Cache the column schema
					for (const columnSchema of tableSchema.columns) {
						this._columnSchemaCache.set(columnSchema.column_index, columnSchema);
					}
				}

				// Set display order to the viewable slice of sorted results
				this._displayPositionOrder = viewableColumns;

				// Update the columns count to the total number of matches (not just searched results in view)
				this._columns = searchResult.matches.length;
			} else {
				// No matches found, clear display
				this._displayPositionOrder = [];
				this._columns = 0;
			}
		} else {
			// No search/sort, use getSchema to fetch the viewable data
			if (columnIndices.length > 0) {
				const tableSchema = await this._dataExplorerClientInstance.getSchema(columnIndices);

				// If we are invalidating the cache, we need to clear it before updating
				if (invalidateCache) {
					this._columnSchemaCache.clear();
					this._columnProfileCache.clear();
				}

				// Cache the column schema
				for (const columnSchema of tableSchema.columns) {
					this._columnSchemaCache.set(columnSchema.column_index, columnSchema);
				}
			}

			// Update the display position order to include all columns in the view range
			this._displayPositionOrder = arrayFromIndexRange(startColumnIndex, endColumnIndex);
		}

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();

		// Update the column profile cache for the appropriate column indices
		await this.updateColumnProfileCache(this._displayPositionOrder);

		// Clear the updating flag.
		this._updating = false;

		// If there's a pending update descriptor, update the cache again.
		if (this._pendingUpdateDescriptor) {
			// Get the pending update descriptor and clear it.
			const pendingUpdateDescriptor = this._pendingUpdateDescriptor;
			this._pendingUpdateDescriptor = undefined;

			// Update the cache for the pending update descriptor.
			return this.update2(pendingUpdateDescriptor);
		}

		// Schedule trimming the cache.
		if (!invalidateCache) {
			// Set the trim cache timeout.
			this._trimCacheTimeout = setTimeout(() => {
				// Release the trim cache timeout.
				this._trimCacheTimeout = undefined;

				// Trim the cache.
				this.trimCache(this._displayPositionOrder);
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
	 * Gets the column schema for the specified display index.
	 * @param displayIndex The display position index for the column.
	 * @returns The column schema for the specified display index.
	 */
	getColumnSchema(displayIndex: number) {
		const originalIndex = summaryPanelEnhancementsFeatureEnabled(this._configurationService)
			? this._displayPositionOrder[displayIndex]
			: displayIndex;
		return originalIndex !== undefined ? this._columnSchemaCache.get(originalIndex) : undefined;
	}

	/**
	 * Gets the column profile for the specified display index.
	 * @param displayIndex The display position index for the column.
	 * @returns The column profile for the specified display index.
	 */
	getColumnProfile(displayIndex: number) {
		const originalIndex = summaryPanelEnhancementsFeatureEnabled(this._configurationService)
			? this._displayPositionOrder[displayIndex]
			: displayIndex;
		return originalIndex !== undefined ? this._columnProfileCache.get(originalIndex) : undefined;
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
				// Number.
				case ColumnDisplayType.Number: {
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

		return dataExplorerExperimentalFeatureEnabled(
			histogramSupportStatus.support_status,
			this._configurationService
		);
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

		return dataExplorerExperimentalFeatureEnabled(
			frequencyTableSupportStatus.support_status,
			this._configurationService
		);
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
	private trimCache(columnIndicesToKeep: number[]) {
		// Create a set for faster lookup of indices to keep.
		const indicesToKeepSet = new Set(columnIndicesToKeep);

		// Trim the column schema cache.
		for (const columnIndex of this._columnSchemaCache.keys()) {
			if (!indicesToKeepSet.has(columnIndex)) {
				this._columnSchemaCache.delete(columnIndex);
			}
		}

		// Trim the column profile cache.
		for (const columnIndex of this._columnProfileCache.keys()) {
			if (!indicesToKeepSet.has(columnIndex)) {
				this._columnProfileCache.delete(columnIndex);
			}
		}
	}

	//#endregion Private Methods
}
