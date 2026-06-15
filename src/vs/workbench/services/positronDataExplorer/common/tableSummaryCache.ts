/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
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

/**
 * The number of columns whose profiles are requested per backend round-trip. Profiles are loaded in
 * chunks so that results appear progressively and so that a cancellation (the user scrolling to a
 * new set of columns) takes effect within roughly one chunk rather than after the whole window.
 */
const PROFILE_CHUNK_SIZE = 8;

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
	 * The cancellation token source for the in-flight column profile pass. Cancelling it stops the
	 * pass from issuing further chunks and abandons the chunk currently in flight, so a new pass
	 * (started when the user scrolls to a different set of columns) is not stuck behind stale work.
	 */
	private readonly _profileCts = this._register(new MutableDisposable<CancellationTokenSource>());

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

		// Cancel any in-flight column profile pass so its awaiters settle.
		this._profileCts.value?.cancel();

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
		// This loads independently of the visible-window profile pass (no shared cancellation
		// token) so expanding a column neither cancels that pass nor is cancelled by it.
		this._expandedColumns.add(columnIndex);
		this._onDidUpdateEmitter.fire();
		await this.loadColumnProfiles([columnIndex], CancellationToken.None);
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
			// Cancel the in-flight profile pass so it stops issuing chunks promptly and the new
			// descriptor (the columns the user scrolled to) is processed without waiting for the
			// stale histogram/frequency work to finish.
			this._profileCts.value?.cancel();
			return;
		}

		// Set the updating flag. This is cleared in the finally block below, even when a backend
		// task rejects, so that a single failed update (e.g. a column profile timing out on a very
		// wide dataset) cannot permanently wedge the cache and freeze summary pagination.
		this._updating = true;
		try {
			// Get the size of the data.
			const tableState = await this._dataExplorerClientInstance.getBackendState();
			this._columns = tableState.table_shape.num_columns;
			this._rows = tableState.table_shape.num_rows;

			// The visible window of columns this update is for.
			const visibleIndices = updateDescriptor.columnIndices;

			// Determine which columns need their schema loaded. On invalidation we reload the whole
			// window; otherwise only columns whose schema isn't already cached.
			const schemaIndices = updateDescriptor.invalidateCache
				? visibleIndices
				: visibleIndices.filter(index => !this._columnSchemaCache.has(index));

			// Load the column schema for those columns.
			const tableSchema = await this._dataExplorerClientInstance.getSchema(schemaIndices);

			// Invalidate the cache, if we're supposed to.
			if (updateDescriptor.invalidateCache) {
				this._columnSchemaCache.clear();
				this._columnProfileCache.clear();
			}

			// Cache the column schema that was returned.
			for (const columnSchema of tableSchema.columns) {
				this._columnSchemaCache.set(columnSchema.column_index, columnSchema);
			}

			// Fire the onDidUpdate event so newly loaded schema renders before profiles arrive.
			this._onDidUpdateEmitter.fire();

			// Determine which visible columns still need a profile. This is deliberately independent
			// of the schema fetch above: a column's schema may already be cached (e.g. fetched while
			// the user scrolled past it) while its profile was never computed -- for instance because
			// an earlier profile pass was cancelled when the user kept moving. Gating profiles on the
			// schema-miss set would skip those columns and leave them permanently without a
			// histogram/frequency summary (this is what broke when jumping to the middle of a wide
			// table). On invalidation the profile cache was just cleared, so the whole window needs
			// profiles.
			const profileIndices = updateDescriptor.invalidateCache
				? visibleIndices
				: visibleIndices.filter(index => !this._columnProfileCache.has(index));

			// Load the column profiles as a fresh cancelable pass.
			await this.updateColumnProfileCache(profileIndices);

			// Schedule trimming the cache if we didn't already invalidate the cache and we have
			// column indices to keep. We don't want to schedule a trim if columnIndices is empty
			// which can happen during UI rendering transitions (e.g.during resizing when layoutHeight
			// is 0) because that would clear all cached data.
			if (!updateDescriptor.invalidateCache && updateDescriptor.columnIndices.length) {
				// Clear previously scheduled trim calls before scheduling a new one
				// to prevent previously scheduled trim calls from clearing data that
				// is now visible and should be in the cache. This can happen when a
				// user is scrolling rapidly.
				this.clearTrimCacheTimeout();
				// Set the trim cache timeout.
				this._trimCacheTimeout = setTimeout(() => {
					// Release the trim cache timeout.
					this._trimCacheTimeout = undefined;
					// Trim the cache.
					this.trimCache(new Set(updateDescriptor.columnIndices));
				}, TRIM_CACHE_TIMEOUT);
			}
		} catch (error) {
			// Log and swallow. Rethrowing would skip draining the pending descriptor below, which
			// would stall scroll-driven updates after a transient backend failure.
			console.error('Failed to update the table summary cache:', error);
		} finally {
			// Clear the updating flag.
			this._updating = false;

			// If an update arrived while this one was in flight, process it now so that scrolling
			// continues to load columns even after a failure.
			if (this._pendingUpdateDescriptor) {
				// Get the pending update descriptor and clear it.
				const pendingUpdateDescriptor = this._pendingUpdateDescriptor;
				this._pendingUpdateDescriptor = undefined;

				// Update the cache for the pending update descriptor.
				await this.update(pendingUpdateDescriptor);
			}
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
	 * Updates the column profile cache for the specified column indices as a fresh, cancelable pass.
	 * Cancels any pass already in flight so that, when the user scrolls to a new set of columns, the
	 * new window's profiles are not queued behind stale histogram/frequency work.
	 * @param columnIndices The column indices.
	 */
	private async updateColumnProfileCache(columnIndices: number[]) {
		// Cancel any in-flight profile pass and start a fresh one.
		this._profileCts.value?.cancel();
		const cts = new CancellationTokenSource();
		this._profileCts.value = cts;
		await this.loadColumnProfiles(columnIndices, cts.token);
	}

	/**
	 * Loads profiles for the specified column indices in cancelable chunks, caching each chunk and
	 * firing onDidUpdate as it arrives so profiles are revealed progressively. Honors the supplied
	 * cancellation token between and during chunks.
	 * @param columnIndices The column indices.
	 * @param token The cancellation token for this load.
	 */
	private async loadColumnProfiles(columnIndices: number[], token: CancellationToken) {
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

		// Process the requests in small chunks. After each chunk we cache its results and fire the
		// onDidUpdate event, so profiles are revealed progressively rather than all at once when the
		// whole window finishes computing. Between chunks we bail if the pass was cancelled because
		// the user scrolled to a different set of columns.
		for (let i = 0; i < columnRequests.length; i += PROFILE_CHUNK_SIZE) {
			// Stop issuing chunks once the pass has been cancelled.
			if (token.isCancellationRequested) {
				return;
			}

			// Request this chunk's profiles. The token is forwarded so the in-flight request is
			// abandoned on cancellation.
			const chunk = columnRequests.slice(i, i + PROFILE_CHUNK_SIZE);
			const results = await this._dataExplorerClientInstance.getColumnProfiles(chunk, token);

			// If the pass was cancelled while awaiting, drop the results (cancellation resolves the
			// request to an empty array) and stop without firing an update.
			if (token.isCancellationRequested) {
				return;
			}

			// Cache the column profiles that were returned.
			for (let j = 0; j < results.length && j < chunk.length; j++) {
				this._columnProfileCache.set(chunk[j].column_index, results[j]);
			}

			// Fire the onDidUpdate event so the just-loaded columns render.
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
