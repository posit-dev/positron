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

		let columnIndices: number[] = [];
		let searchResult: SearchSchemaResult | null = null;

		// If the cache is invalidated we will need to load
		// all the columns in view into the cache again
		if (invalidateCache) {
			columnIndices = arrayFromIndexRange(startColumnIndex, endColumnIndex);
		} else {
			// If the cache is not invalidated and the search text has not changed,
			// we will only load the columns in view that are not already cached
			for (let columnIndex = startColumnIndex; columnIndex <= endColumnIndex; columnIndex++) {
				if (!this._columnSchemaCache.has(columnIndex)) {
					columnIndices.push(columnIndex);
				}
			}
		}

		// When search text is present, use backend search to get the columns into the schema cache
		// When there is no search text, use `getSchema` to get the default order of columns into the cache
		if (this._searchText) {
			// Use the new search method that supports backend search and sort
			searchResult = await this._dataExplorerClientInstance.searchSchema2({
				searchText: this._searchText,
				sortOption: this._sortOption,
			});

			// If we have matches, fetch the schema for those specific columns
			if (searchResult.matches.length > 0) {
				const tableSchema = await this._dataExplorerClientInstance.getSchema(searchResult.matches);

				// Cache the column schema for the matching columns
				for (let i = 0; i < tableSchema.columns.length; i++) {
					const columnIndex = searchResult.matches[i];
					this._columnSchemaCache.set(columnIndex, tableSchema.columns[i]);
				}

				// Update the render order to match the search results
				this._displayPositionOrder = searchResult.matches;

				// Update the columns count based on search results
				this._columns = searchResult.matches.length;
			} else {
				// No matches found, clear list of indices to render
				this._displayPositionOrder = [];
				this._columns = 0;
			}
		} else {
			// No search text, use regular getSchema
			const tableSchema = await this._dataExplorerClientInstance.getSchema(columnIndices);

			// If we are invalidating the cache, we need to clear it before updating
			// this can happen when the user clears the search text
			if (invalidateCache) {
				this._columnSchemaCache.clear();
				this._columnProfileCache.clear();
			}

			// Cache the column schema that was returned
			for (let i = 0; i < tableSchema.columns.length; i++) {
				this._columnSchemaCache.set(columnIndices[i], tableSchema.columns[i]);
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

		// For more than 10 million rows, we request profiles one by one rather than as a batch for
		// better responsiveness
		const BATCHING_THRESHOLD = 5_000_000;
		if (tableState.table_shape.num_rows > BATCHING_THRESHOLD) {
			const BATCH_SIZE = 4;
			for (let i = 0; i < columnIndices.length; i += BATCH_SIZE) {
				// Get the next batch of up to 4 requests
				const batchColumnRequests = columnRequests.slice(i, i + BATCH_SIZE);
				const batchColumnIndices = columnIndices.slice(i, i + BATCH_SIZE);

				// Send the batch of requests to getColumnProfiles
				const results = await this._dataExplorerClientInstance.getColumnProfiles(batchColumnRequests);

				// Cache the returned column profiles for each index in the batch
				for (let j = 0; j < results.length; j++) {
					this._columnProfileCache.set(batchColumnIndices[j], results[j]);
				}

				// Fire the onDidUpdate event so things update as soon as they are returned
				this._onDidUpdateEmitter.fire();
			}
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
