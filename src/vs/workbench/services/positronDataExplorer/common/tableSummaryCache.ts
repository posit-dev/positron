/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { DataExplorerClientInstance, DataExplorerClientStatus } from '../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
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
 * How many columns to ask about in the first chunk of a detail pass.
 *
 * One, because the first chunk is a measurement as much as a request. Every backend computes the
 * histograms and frequency tables in a batch one column at a time, so the cost of a chunk is
 * roughly its size times whatever a column costs on this source -- a figure that spans orders of
 * magnitude between a local parquet file and a remote warehouse, and that nothing here can know in
 * advance. Asking about one column first and sizing the rest from what it cost beats guessing.
 */
const PROFILE_CHUNK_PROBE_SIZE = 1;

/**
 * The most columns to ask about in one chunk of a detail pass.
 *
 * Chunks are not made arbitrarily large on a fast source, because a chunk is also the granularity
 * at which results appear and at which a cancellation takes effect. Eight keeps a scroll feeling
 * responsive while still amortizing the aggregate scan that a batch shares.
 */
const PROFILE_CHUNK_MAX_SIZE = 8;

/**
 * How long a chunk of a detail pass should aim to take, in milliseconds.
 *
 * Chunks are sized to land near this rather than to fill the request timeout, so that a source
 * that turns out to be three times slower than its last chunk suggested still comes in under the
 * timeout instead of losing the whole chunk -- and losing a chunk is not a small thing, because a
 * request that exceeds the timeout takes the whole panel down with it. Columns vary enough among
 * themselves, a wide string column's frequency table against a small integer histogram, that this
 * much headroom is ordinary rather than cautious.
 *
 * It is also how often a slow source gets to show its work: the smaller the chunk, the sooner the
 * sparklines it has managed appear.
 */
const PROFILE_CHUNK_TARGET = 3_000;

/**
 * How long a detail pass may spend before it stops and leaves the rest, in milliseconds.
 *
 * The request timeout says when a source has failed. This says when one that is working isn't
 * worth waiting for any longer, which is a different question and the one the user is actually
 * asking. A source at two seconds a column never times out -- every chunk of one succeeds -- and
 * would grind through a wide window for minutes while the panel reported progress the whole time.
 *
 * Thirty seconds of that is enough. What has been computed is kept, the columns behind it are
 * reported rather than left turning, and carrying on is offered as something the user chooses
 * rather than something they wait out. The budget is checked between chunks, so a pass can run
 * over it by as much as the chunk that was already in flight.
 */
const PROFILE_PASS_BUDGET = 30_000;

/**
 * UpdateDescriptor interface.
 */
interface UpdateDescriptor {
	invalidateCache: boolean;
	columnIndices: number[];
}

/**
 * Why the column profiles aren't all there.
 *
 * `calculation` is the backend saying no -- it timed out, errored, or returned nothing for columns
 * it was asked about. `disconnected` is there being no backend left to ask, which is not a fault of
 * the data and is not something retrying can get past. `paused` is nothing being wrong at all: the
 * source is answering, just slowly enough that the pass stopped rather than grind on, and going
 * again picks up where it left off.
 */
export type ColumnProfilesFailure = 'calculation' | 'disconnected' | 'paused';

/**
 * Combines a column profile result with what was already known about that column, preferring the
 * newer value wherever it has one.
 *
 * Field by field rather than by spreading, because a result carries only the profiles its own
 * request asked for and says nothing at all about the others -- but how it says nothing differs by
 * backend, some omitting the field and some sending it as null. The Python backend builds its
 * result through pydantic and serializes every field, so a request for null counts alone comes
 * back declaring a null histogram; DuckDB omits the key entirely.
 *
 * Every field is rebuilt through `??` for that reason, including when there is nothing to merge
 * with. That is what puts the two backends' ways of saying nothing into one shape on the way into
 * the cache -- a null becomes undefined -- so that everything downstream can ask whether a profile
 * is there by testing for undefined and get the same answer whichever backend answered.
 * @param existing What is already cached for the column, if anything.
 * @param incoming The result that just arrived.
 * @returns The combined profile, with absent profiles undefined rather than null.
 */
function mergeColumnProfile(
	existing: ColumnProfileResult | undefined,
	incoming: ColumnProfileResult
): ColumnProfileResult {
	return {
		null_count: incoming.null_count ?? existing?.null_count,
		summary_stats: incoming.summary_stats ?? existing?.summary_stats,
		small_histogram: incoming.small_histogram ?? existing?.small_histogram,
		large_histogram: incoming.large_histogram ?? existing?.large_histogram,
		small_frequency_table: incoming.small_frequency_table ?? existing?.small_frequency_table,
		large_frequency_table: incoming.large_frequency_table ?? existing?.large_frequency_table,
	};
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
	 * Why the backend was asked for column profiles and did not deliver them, or undefined while it
	 * still might. The two reasons are told apart because they are not the same news and do not
	 * offer the user the same thing to do about it: a source that cannot summarize may well answer
	 * a second attempt, whereas one that has gone away will answer nothing until it is back.
	 *
	 * Deliberately a property of the whole panel rather than of the columns that happened to be in
	 * the failing batch. Some data sources simply cannot compute these summaries; a backend that
	 * spent five minutes failing to profile eight columns will not do better with the next eight,
	 * and a column left merely uncached is re-requested the moment it scrolls back into view, which
	 * on such a source means waiting all over again and never settling. So one failure stops the
	 * pass and puts the panel into a state it stays in until the user retries or the data changes
	 * underneath it.
	 */
	private _columnProfilesFailure?: ColumnProfilesFailure;

	/**
	 * What a column's histograms and frequency tables last cost this source, in milliseconds, or
	 * undefined until a chunk has been timed. Chunks are sized from it, so a source that answers in
	 * milliseconds is asked about eight columns at a time and one that takes seconds a column is
	 * asked about one or two -- which is the difference between a slow source delivering its
	 * summaries a few at a time and delivering none of them at all.
	 *
	 * The latest measurement rather than an average of them. What it is being used for is the next
	 * chunk, and the best evidence about the next chunk is the one just before it: a source that
	 * has slowed down should be believed now rather than after several chunks have averaged the
	 * old figure out.
	 */
	private _detailCostPerColumn?: number;

	/**
	 * Whether a retry of the column profiles the user asked for is running.
	 *
	 * The summary panel keeps its notice row for the length of this, which is not only so the user
	 * can see the retry happening. Dropping the row would resize the data grid below it, and a
	 * resize fetches data, and that fetch would start a profile pass of its own -- cancelling the
	 * retry partway and restarting its clock. Standing still is what lets the retry run its course.
	 */
	private _columnProfilesRetrying = false;

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

	/**
	 * Gets a value which indicates whether the backend failed to deliver column profiles, so none
	 * of the columns will get a summary until the user retries or the source comes back.
	 */
	get columnProfilesFailed() {
		return this._columnProfilesFailure !== undefined;
	}

	/**
	 * Gets why the backend failed to deliver column profiles, or undefined if it hasn't.
	 */
	get columnProfilesFailure() {
		return this._columnProfilesFailure;
	}

	/**
	 * Gets a value which indicates whether the failure came after some columns had already been
	 * summarized, which is the usual shape of it: a pass gives up at the first chunk it cannot get
	 * through, so the chunks that landed before it keep their summaries and the columns behind it
	 * never get one. Worth telling apart because the panel is not empty in that case, and saying
	 * the summaries are unavailable while several of them are on screen would read as a mistake.
	 *
	 * Only ever true alongside a failure. A cache holding every column's profile cannot be in one:
	 * a pass that leaves nothing missing has nothing to report, and the data changing underneath
	 * clears the cache and the failure together.
	 */
	get columnProfilesPartial() {
		return this.columnProfilesFailed && this._columnProfileCache.size > 0;
	}

	/**
	 * Gets a value which indicates whether a retry of the column profiles is running.
	 */
	get columnProfilesRetrying() {
		return this._columnProfilesRetrying;
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

		// Don't ask a backend that has already failed at this. Expanding still works -- the column
		// opens and shows what the schema gave us -- it just doesn't start another long wait.
		if (this.columnProfilesFailed) {
			return;
		}

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

				// The data underneath has changed, so the backend deserves another chance at
				// profiling it -- this may be a different table entirely, and what a column cost
				// on the last one says nothing about what one costs on this.
				this._columnProfilesFailure = undefined;
				this._detailCostPerColumn = undefined;
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
				: visibleIndices.filter(index => this.needsColumnProfiles(index));

			// Load the column profiles as a fresh cancelable pass, unless this backend has already
			// shown it cannot compute them. Scrolling must not keep asking a source that failed:
			// every pass would cost another timeout and put the columns back to looking like they
			// were loading. Getting out of this state is the user's call, through retryColumnProfiles.
			//
			// A retry in flight holds this off for the same reason. A pass started here would
			// cancel it -- they share one token source -- and the user would watch the retry they
			// asked for end, with its notice, the moment they scrolled or dragged the splitter.
			// The columns this update wanted are picked up by the catch-up pass the retry runs
			// when it finishes.
			//
			// An invalidating update is the exception and does cancel it. The data underneath has
			// changed, so the retry is computing summaries of a table that is no longer there, and
			// finishing it would only cache answers to a question nobody is asking any more.
			const retryHoldsOff = this._columnProfilesRetrying && !updateDescriptor.invalidateCache;
			if (!this.columnProfilesFailed && !retryHoldsOff) {
				await this.updateColumnProfileCache(profileIndices);
			}

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

	/**
	 * Retries loading the column profiles for the specified column indices after a failure.
	 * @param columnIndices The column indices to load profiles for.
	 */
	async retryColumnProfiles(columnIndices: number[]): Promise<void> {
		if (!this.columnProfilesFailed) {
			return;
		}

		// With no columns to ask about there is nothing to retry, and clearing the failed state
		// would only take away the notice -- and the button the user just pressed -- without
		// loading anything in its place.
		if (!columnIndices.length) {
			return;
		}

		// Trade the failed state for the retrying one. Both keep the panel's notice row, so the row
		// does not come and go underneath the retry and resize the grid below it.
		//
		// The pass restores the failed state itself if it can't load what it asked for, and if it
		// is cancelled the pass that cancelled it answers for these columns instead.
		this._columnProfilesFailure = undefined;
		this._columnProfilesRetrying = true;
		this._onDidUpdateEmitter.fire();

		try {
			await this.updateColumnProfileCache(columnIndices);
		} finally {
			this._columnProfilesRetrying = false;
			this._onDidUpdateEmitter.fire();
		}
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
	 * Loads profiles for the specified column indices, in two passes.
	 *
	 * The passes exist because the two halves of a profile cost wildly different amounts. Every
	 * backend answers a batch with one aggregate query covering all of its columns, and then one
	 * further query per column for that column's histogram or frequency table. The null counts come
	 * out of the shared aggregate and are close to free; the histograms are the per-column work, and
	 * on a slow source they are the entire cost.
	 *
	 * Asking for both together means the cheap half is held hostage by the expensive half: a source
	 * that cannot draw eighty sparklines inside the timeout also fails to report a single missing
	 * value count, though it had them in hand. Asking separately means the missing-values bars land
	 * for the whole window almost at once, and the sparklines fill in behind them at whatever rate
	 * the source can manage -- which on a slow source is the difference between summaries arriving
	 * slowly and no summaries at all.
	 *
	 * Both passes honor the cancellation token, between and during requests.
	 * @param columnIndices The column indices.
	 * @param token The cancellation token for this load.
	 */
	private async loadColumnProfiles(columnIndices: number[], token: CancellationToken) {
		// When this pass has to stop whether or not it is finished. Covers both passes, so a slow
		// null count spends the same budget the sparklines would have.
		const deadline = Date.now() + PROFILE_PASS_BUDGET;

		// Pass one: the null counts, for every column that hasn't got one. Sent as a single request
		// however wide the window is, because it is one aggregate query at the other end no matter
		// how many columns it names, and chunking it would only pay for that query again per chunk.
		const nullCountRequests = columnIndices
			.map(columnIndex => this.buildNullCountRequest(columnIndex))
			.filter(request => request !== undefined);
		if (nullCountRequests.length && !await this.requestColumnProfiles(nullCountRequests, token)) {
			return;
		}

		// Pass two: the histograms, frequency tables and summary statistics, in chunks sized to what
		// this source has been costing. Each chunk is cached and announced as it lands, so the
		// sparklines appear as they are computed rather than all at once at the end.
		const detailRequests = columnIndices
			.map(columnIndex => this.buildDetailRequest(columnIndex))
			.filter(request => request !== undefined);
		for (let i = 0; i < detailRequests.length;) {
			// Stop issuing chunks once the pass has been cancelled.
			if (token.isCancellationRequested) {
				return;
			}

			// Stop issuing chunks once the pass has spent its budget. Nothing has gone wrong here
			// -- the source is answering, and the columns already done keep what they got -- so
			// the panel says it stopped rather than that it failed, and leaves going on to the
			// user. Checked before a chunk rather than during one: a request in flight is already
			// paid for, and abandoning it would throw away work that is about to land.
			if (Date.now() >= deadline) {
				this._columnProfilesFailure = 'paused';
				this._onDidUpdateEmitter.fire();
				return;
			}

			// Take as many columns as the last chunk's rate says will fit the target, and time this
			// one so the next is sized from it.
			const chunk = detailRequests.slice(i, i + this.nextDetailChunkSize());
			const started = Date.now();
			if (!await this.requestColumnProfiles(chunk, token)) {
				return;
			}
			this._detailCostPerColumn = (Date.now() - started) / chunk.length;
			i += chunk.length;
		}

		// Both passes ran to the end without throwing, and still left columns they asked about
		// without profiles. An empty result is also how a cancelled request comes back, and that case
		// is recoverable -- the next update re-requests those columns, which is what the profile
		// cache drives the request set from. A disconnected client answers the same way and is not
		// recoverable: it never threw, so the catch never saw it, and nothing is coming for those
		// columns however often they are asked for. That one the panel reports, rather than leaving
		// every column on a placeholder that no longer stands for anything.
		if (this._dataExplorerClientInstance.status === DataExplorerClientStatus.Disconnected &&
			columnIndices.some(columnIndex => this.needsColumnProfiles(columnIndex))) {
			this._columnProfilesFailure = 'disconnected';
			this._onDidUpdateEmitter.fire();
		}
	}

	/**
	 * Sends one batch of profile requests and merges what comes back into the cache.
	 * @param requests The column profile requests to send.
	 * @param token The cancellation token for this load.
	 * @returns true if the caller should keep going; false if the pass is over, because the request
	 * failed or because it was cancelled.
	 */
	private async requestColumnProfiles(
		requests: ColumnProfileRequest[],
		token: CancellationToken
	): Promise<boolean> {
		// Request the profiles. The token is forwarded so the in-flight request is abandoned on
		// cancellation.
		let results: Array<ColumnProfileResult>;
		try {
			results = await this._dataExplorerClientInstance.getColumnProfiles(requests, token);
		} catch (error) {
			// Take the whole panel down with this batch and stop. Trying the chunks after it would
			// cost another timeout apiece to reach the same conclusion, and leaving their columns
			// merely uncached would have them re-requested on the next scroll.
			console.error('Failed to load column profiles:', error);
			this._columnProfilesFailure = this.columnProfilesFailureReason();
			this._onDidUpdateEmitter.fire();
			return false;
		}

		// If the pass was cancelled while awaiting, drop the results (cancellation resolves the
		// request to an empty array) and stop without firing an update.
		if (token.isCancellationRequested) {
			return false;
		}

		// Merge the results into the cache rather than replacing what is there. A column's profile
		// is assembled over both passes, and a result only carries what its own request asked for --
		// so the detail pass's histogram would otherwise arrive and take the null count with it.
		for (let i = 0; i < results.length && i < requests.length; i++) {
			const columnIndex = requests[i].column_index;
			this._columnProfileCache.set(
				columnIndex,
				mergeColumnProfile(this._columnProfileCache.get(columnIndex), results[i])
			);
		}

		// Fire the onDidUpdate event so the just-loaded columns render.
		this._onDidUpdateEmitter.fire();
		return true;
	}

	/**
	 * Determines how many columns the next chunk of a detail pass should ask about.
	 * @returns The number of columns for the next chunk.
	 */
	private nextDetailChunkSize(): number {
		// Nothing has been timed on this source yet, so the next chunk is the probe that times it.
		if (this._detailCostPerColumn === undefined) {
			return PROFILE_CHUNK_PROBE_SIZE;
		}

		// A chunk that came back inside the clock's resolution says only that this source is fast,
		// which is what the ceiling is for.
		if (this._detailCostPerColumn <= 0) {
			return PROFILE_CHUNK_MAX_SIZE;
		}

		// Otherwise take as many columns as that rate fits into the target, never fewer than one --
		// a source slow enough to blow the target on a single column still has to be asked about it,
		// and the request timeout is what decides whether that is hopeless.
		const fitted = Math.floor(PROFILE_CHUNK_TARGET / this._detailCostPerColumn);
		return Math.min(Math.max(fitted, 1), PROFILE_CHUNK_MAX_SIZE);
	}

	/**
	 * Builds the null count request for a column, if it still needs one.
	 * @param columnIndex The column index.
	 * @returns The request, or undefined if the column's null count is already cached.
	 */
	private buildNullCountRequest(columnIndex: number): ColumnProfileRequest | undefined {
		if (this._columnProfileCache.get(columnIndex)?.null_count !== undefined) {
			return undefined;
		}

		return {
			column_index: columnIndex,
			profiles: [{ profile_type: ColumnProfileType.NullCount }]
		};
	}

	/**
	 * Builds the detail request for a column -- its sparkline, and its summary statistics if it is
	 * expanded -- covering only what isn't cached already. Asking again for a profile that is
	 * already in hand would pay for it twice, which on the sources this chunking exists for is the
	 * whole of the cost.
	 * @param columnIndex The column index.
	 * @returns The request, or undefined if the column has everything its type calls for.
	 */
	private buildDetailRequest(columnIndex: number): ColumnProfileRequest | undefined {
		const cached = this._columnProfileCache.get(columnIndex);
		const columnSchema = this._columnSchemaCache.get(columnIndex);
		const columnExpanded = this._expandedColumns.has(columnIndex);
		const profiles: ColumnProfileSpec[] = [];

		// If the column is expanded, load the summary stats.
		if (columnExpanded && cached?.summary_stats === undefined) {
			profiles.push({ profile_type: ColumnProfileType.SummaryStats });
		}

		// Determine whether to load the histogram or the frequency table for the column.
		switch (columnSchema?.type_display) {
			// Number (including all numeric subtypes).
			case ColumnDisplayType.Floating:
			case ColumnDisplayType.Integer:
			case ColumnDisplayType.Decimal: {
				// If histograms are supported, load them.
				if (this.isHistogramSupported()) {
					// Load the small histogram.
					if (cached?.small_histogram === undefined) {
						profiles.push({
							profile_type: ColumnProfileType.SmallHistogram,
							params: {
								method: ColumnHistogramParamsMethod.FreedmanDiaconis,
								num_bins: SMALL_HISTOGRAM_NUM_BINS,
							}
						});
					}

					// If the column is expanded, load the large histogram.
					if (columnExpanded && cached?.large_histogram === undefined) {
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
				// If frequency tables are supported, load them. Note that we do not load the large
				// frequency table because there are only two possible values.
				if (this.isFrequencyTableSupported() && cached?.small_frequency_table === undefined) {
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
				if (this.isFrequencyTableSupported()) {
					// Load the small frequency table.
					if (cached?.small_frequency_table === undefined) {
						profiles.push({
							profile_type: ColumnProfileType.SmallFrequencyTable,
							params: {
								limit: SMALL_FREQUENCY_TABLE_LIMIT
							}
						});
					}

					// If the column is expanded, load the large frequency table.
					if (columnExpanded && cached?.large_frequency_table === undefined) {
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

		return profiles.length ? { column_index: columnIndex, profiles } : undefined;
	}

	/**
	 * Determines whether a column is still missing any of the profiles its type calls for.
	 * @param columnIndex The column index.
	 * @returns true if the column has profiles left to load; otherwise, false.
	 */
	private needsColumnProfiles(columnIndex: number): boolean {
		return this.buildNullCountRequest(columnIndex) !== undefined ||
			this.buildDetailRequest(columnIndex) !== undefined;
	}

	/**
	 * Determines why a profile load failed, which comes down to whether there is still a backend on
	 * the other end of it. A client whose comm has closed answers rather than rejects -- with an
	 * empty result -- so the shape of the failure says nothing about its cause and the client's own
	 * status is what distinguishes the two.
	 * @returns The reason to report for the failure.
	 */
	private columnProfilesFailureReason(): ColumnProfilesFailure {
		return this._dataExplorerClientInstance.status === DataExplorerClientStatus.Disconnected
			? 'disconnected'
			: 'calculation';
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
