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
import { ColumnDisplayType, ColumnHistogramParamsMethod, ColumnProfileRequest, ColumnProfileResult, ColumnProfileSpec, ColumnProfileType, ColumnSchema } from '../../languageRuntime/common/positronDataExplorerComm.js';

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

		// Fire the onDidUpdate event.
		this._onDidUpdateEmitter.fire();

		// Update the column profile cache.
		await this.updateColumnProfileCache([columnIndex]);
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
