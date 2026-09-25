/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { TableSummaryCache } from '../../common/tableSummaryCache.js';
import { getColumnSchema } from '../../common/positronDataExplorerMocks.js';
import { DataExplorerClientInstance } from '../../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import {
	BackendState,
	ColumnDisplayType,
	ColumnProfileRequest,
	ColumnProfileResult,
	ColumnProfileType,
	SchemaUpdateEvent,
	SupportStatus,
	TableSchema
} from '../../../languageRuntime/common/positronDataExplorerComm.js';

/** A stand-in histogram, for mocked profile results that only need the field to be present. */
const HISTOGRAM = { bin_edges: ['0', '1'], bin_counts: [1], quantiles: [] };

/**
 * A profile result as a backend that serializes its whole model sends one: every field present,
 * and the ones it was not asked to compute reported as null rather than left out. This is not
 * `ColumnProfileResult`, whose absent fields are undefined, and the difference is the point --
 * anything reading these results has to treat the two the same way.
 */
type SerializedColumnProfileResult = {
	[K in keyof ColumnProfileResult]: ColumnProfileResult[K] | null;
};

/**
 * Builds a getColumnProfiles implementation that charges the given number of milliseconds per
 * column, but only for the detail pass -- null counts come out of an aggregate the batch runs
 * anyway, and charging for them would measure the wrong pass. Requires faked Date.
 */
function detailCostPerColumn(costMs: number) {
	return async (requests: ColumnProfileRequest[]): Promise<ColumnProfileResult[]> => {
		const detailColumns = requests.filter(request =>
			request.profiles.some(spec => spec.profile_type !== ColumnProfileType.NullCount)
		).length;
		if (detailColumns) {
			vi.setSystemTime(Date.now() + costMs * detailColumns);
		}
		return respondToProfileRequests(requests);
	};
}

/**
 * Answers profile requests with exactly the profiles they asked for and nothing else, as a backend
 * does. Which matters to the two-pass loader: a response that volunteered every profile would hide
 * whether the passes are asking for the right things, and whether their results combine.
 */
function respondToProfileRequests(requests: ColumnProfileRequest[]): ColumnProfileResult[] {
	return requests.map(request => {
		const result: ColumnProfileResult = {};
		for (const spec of request.profiles) {
			if (spec.profile_type === ColumnProfileType.NullCount) {
				result.null_count = request.column_index;
			} else if (spec.profile_type === ColumnProfileType.SmallHistogram) {
				result.small_histogram = HISTOGRAM;
			}
		}
		return result;
	});
}

/** Builds an array of `count` consecutive column indices starting at `start`. */
function range(start: number, count: number): number[] {
	return Array.from({ length: count }, (_, i) => start + i);
}

/**
 * Builds a backend state with the given column count.
 *
 * Histograms and frequency tables are advertised only when asked for. Without them the cache has
 * no detail pass to run and requests null counts alone, which keeps the profile request shape
 * irrelevant to the tests that are not about it.
 */
function backendState(numColumns: number, histograms = false): BackendState {
	const supportedTypes = [{
		profile_type: ColumnProfileType.NullCount,
		support_status: SupportStatus.Supported
	}];
	if (histograms) {
		supportedTypes.push({
			profile_type: ColumnProfileType.SmallHistogram,
			support_status: SupportStatus.Supported
		});
	}
	const profilesFeature = {
		support_status: SupportStatus.Supported,
		supported_types: supportedTypes
	};
	return {
		display_name: 'test-table',
		table_shape: { num_rows: 100, num_columns: numColumns },
		table_unfiltered_shape: { num_rows: 100, num_columns: numColumns },
		has_row_labels: false,
		column_filters: [],
		row_filters: [],
		sort_keys: [],
		supported_features: {
			search_schema: { support_status: SupportStatus.Supported, supported_types: [] },
			set_column_filters: { support_status: SupportStatus.Supported, supported_types: [] },
			set_row_filters: { support_status: SupportStatus.Supported, supports_conditions: SupportStatus.Supported, supported_types: [] },
			get_column_profiles: profilesFeature,
			export_data_selection: { support_status: SupportStatus.Supported, supported_formats: [] },
			set_sort_columns: { support_status: SupportStatus.Supported },
			convert_to_code: { support_status: SupportStatus.Supported }
		}
	};
}

describe('TableSummaryCache', () => {
	let getSchema: ReturnType<typeof vi.fn>;
	let getColumnProfiles: ReturnType<typeof vi.fn>;
	let getSupportedFeatures: ReturnType<typeof vi.fn>;
	let cache: TableSummaryCache;

	beforeEach(() => {
		const state = backendState(10_000);

		// Resolve schema for exactly the requested indices.
		getSchema = vi.fn(async (indices: number[]): Promise<TableSchema> => ({
			columns: indices.map(i => getColumnSchema(`col${i}`, i, 'number', ColumnDisplayType.Floating))
		}));
		getColumnProfiles = vi.fn().mockResolvedValue([]);
		getSupportedFeatures = vi.fn().mockReturnValue(state.supported_features);

		const client: Partial<DataExplorerClientInstance> = {
			onDidSchemaUpdate: new Emitter<SchemaUpdateEvent>().event,
			onDidDataUpdate: new Emitter<void>().event,
			onDidUpdateBackendState: new Emitter<BackendState>().event,
			getBackendState: vi.fn().mockResolvedValue(state),
			getSupportedFeatures: getSupportedFeatures as DataExplorerClientInstance['getSupportedFeatures'],
			getSchema: getSchema as DataExplorerClientInstance['getSchema'],
			getColumnProfiles: getColumnProfiles as DataExplorerClientInstance['getColumnProfiles'],
		};

		cache = new TableSummaryCache(client as DataExplorerClientInstance);
	});

	afterEach(() => {
		cache.dispose();
	});

	it('caches schema for the requested columns', async () => {
		await cache.update({ invalidateCache: true, columnIndices: [0, 1, 2] });
		expect(cache.getColumnSchema(2)?.column_name).toBe('col2');
	});

	it('keeps processing updates after a backend task rejects', async () => {
		ensureNoLeakedDisposables();

		// The first update's profile fetch rejects (e.g. a column profile timing out on a very wide
		// dataset). This used to leave the in-progress guard set, permanently wedging the cache so no
		// further scroll-driven update would load -- the summary froze at the first window of columns.
		getColumnProfiles.mockRejectedValueOnce(new Error('profile boom'));

		await cache.update({ invalidateCache: true, columnIndices: [0, 1] });

		// Despite the profile failure, the schema for the first window was still cached, and a
		// subsequent update (as the user scrolls) is processed rather than silently dropped.
		await cache.update({ invalidateCache: false, columnIndices: [2, 3] });

		expect({
			firstWindowCached: cache.getColumnSchema(0)?.column_name,
			secondWindowCached: cache.getColumnSchema(2)?.column_name,
			schemaFetchCount: getSchema.mock.calls.length,
		}).toEqual({
			firstWindowCached: 'col0',
			secondWindowCached: 'col2',
			schemaFetchCount: 2,
		});
	});

	it('asks for the whole window\'s null counts at once, then details in chunks', async () => {
		getSupportedFeatures.mockReturnValue(backendState(10_000, true).supported_features);
		getColumnProfiles.mockImplementation(
			async (requests: ColumnProfileRequest[]): Promise<ColumnProfileResult[]> =>
				respondToProfileRequests(requests)
		);

		// Count the onDidUpdate events: one after the schema loads, one for the null counts, then
		// one per detail chunk.
		let updateFires = 0;
		const listener = cache.onDidUpdate(() => updateFires++);

		await cache.update({ invalidateCache: true, columnIndices: range(0, 20) });
		listener.dispose();

		const cachedProfiles = range(0, 20).filter(i => cache.getColumnProfile(i) !== undefined).length;

		// The null counts go out as one request for all 20. The detail pass probes with one column
		// and, finding this source instant, takes the ceiling of 8 from there.
		expect({
			requestSizes: getColumnProfiles.mock.calls.map(call => (call[0] as ColumnProfileRequest[]).length),
			cachedProfiles,
			updateFires,
		}).toEqual({
			requestSizes: [20, 1, 8, 8, 3],
			cachedProfiles: 20,
			updateFires: 6,
		});
	});

	it('sizes detail chunks to what a column costs on this source', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			getSupportedFeatures.mockReturnValue(backendState(10_000, true).supported_features);
			getColumnProfiles.mockImplementation(detailCostPerColumn(1_000));

			await cache.update({ invalidateCache: true, columnIndices: range(0, 20) });

			// 20 null counts in one request, then a probe of one column that reveals the rate, and
			// from there chunks of three -- a second a column against a three second target.
			expect(
				getColumnProfiles.mock.calls.map(call => (call[0] as ColumnProfileRequest[]).length)
			).toEqual([20, 1, 3, 3, 3, 3, 3, 3, 1]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('stops a detail pass that outruns its budget, keeping what it got', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			getSupportedFeatures.mockReturnValue(backendState(10_000, true).supported_features);
			getColumnProfiles.mockImplementation(detailCostPerColumn(1_000));

			// 60 columns at a second each is a minute of detail work against a 30 second budget.
			await cache.update({ invalidateCache: true, columnIndices: range(0, 60) });

			const withHistogram = range(0, 60)
				.filter(i => cache.getColumnProfile(i)?.small_histogram !== undefined).length;
			const withNullCount = range(0, 60)
				.filter(i => cache.getColumnProfile(i)?.null_count !== undefined).length;

			// It stops rather than fails, every column still has the null count the cheap pass got
			// for it, and the sparklines it did compute are kept.
			expect({
				failure: cache.columnProfilesFailure,
				withNullCount,
				someHistograms: withHistogram > 0,
				notAllHistograms: withHistogram < 60,
			}).toEqual({
				failure: 'paused',
				withNullCount: 60,
				someHistograms: true,
				notAllHistograms: true,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('asks for profiles a backend reported as null rather than omitting', async () => {
		getSupportedFeatures.mockReturnValue(backendState(10_000, true).supported_features);

		// The Python backend builds its result through pydantic and serializes every field, so a
		// request for null counts alone comes back declaring a null histogram. Read as "already
		// have it", that would stop the detail pass ever asking for one.
		getColumnProfiles.mockImplementation(
			async (requests: ColumnProfileRequest[]): Promise<SerializedColumnProfileResult[]> =>
				respondToProfileRequests(requests).map(result => ({
					null_count: null,
					summary_stats: null,
					small_histogram: null,
					large_histogram: null,
					small_frequency_table: null,
					large_frequency_table: null,
					...result,
				}))
		);

		await cache.update({ invalidateCache: true, columnIndices: [0, 1] });

		expect({
			requestSizes: getColumnProfiles.mock.calls.map(call => (call[0] as ColumnProfileRequest[]).length),
			nullCount: cache.getColumnProfile(1)?.null_count,
			histogram: cache.getColumnProfile(1)?.small_histogram !== undefined,
		}).toEqual({
			requestSizes: [2, 1, 1],
			nullCount: 1,
			histogram: true,
		});
	});

	it('keeps a profile fetched by one pass when the other pass answers', async () => {
		getSupportedFeatures.mockReturnValue(backendState(10_000, true).supported_features);

		// The detail pass answers with the histogram alone, as a backend does when that is all it
		// was asked for. The null count from the first pass has to survive it.
		getColumnProfiles.mockImplementation(
			async (requests: ColumnProfileRequest[]): Promise<ColumnProfileResult[]> =>
				respondToProfileRequests(requests)
		);

		await cache.update({ invalidateCache: true, columnIndices: [0, 1] });

		expect({
			nullCount: cache.getColumnProfile(1)?.null_count,
			histogram: cache.getColumnProfile(1)?.small_histogram !== undefined,
		}).toEqual({
			nullCount: 1,
			histogram: true,
		});
	});

	it('profiles visible columns whose schema is cached but profile is missing', async () => {
		// First pass returns no profiles (simulating a pass cancelled mid-scroll), so the columns
		// end up schema-cached but unprofiled; later calls return real profiles.
		getColumnProfiles
			.mockResolvedValueOnce([])
			.mockImplementation(
				async (requests: ColumnProfileRequest[]): Promise<ColumnProfileResult[]> =>
					requests.map(r => ({ null_count: r.column_index }))
			);

		// First update: schema gets cached, but no profiles are cached.
		await cache.update({ invalidateCache: true, columnIndices: range(0, 4) });
		const afterFirst = {
			schemaCached: cache.getColumnSchema(2)?.column_name,
			profileCached: cache.getColumnProfile(2),
			profileCalls: getColumnProfiles.mock.calls.length,
		};

		// Second update for the same window (no invalidation), as when jumping to a region whose
		// columns were schema-cached while scrolling past. Profiles are still missing and must be
		// fetched now -- gating on the schema-miss set (empty here) used to skip them entirely.
		await cache.update({ invalidateCache: false, columnIndices: range(0, 4) });

		expect({
			afterFirst,
			profileCachedNow: cache.getColumnProfile(2)?.null_count,
			profileCallsTotal: getColumnProfiles.mock.calls.length,
		}).toEqual({
			afterFirst: { schemaCached: 'col2', profileCached: undefined, profileCalls: 1 },
			profileCachedNow: 2,
			profileCallsTotal: 2,
		});
	});

	it('cancels the in-flight pass and abandons remaining chunks when a new update arrives', async () => {
		// Gate the first window's first chunk so a second update can arrive while it is in flight.
		let signalFirstChunkStarted!: () => void;
		const firstChunkStarted = new Promise<void>(resolve => { signalFirstChunkStarted = resolve; });
		let releaseFirstChunk!: () => void;
		const firstChunkGate = new Promise<void>(resolve => { releaseFirstChunk = resolve; });

		let callIndex = 0;
		getColumnProfiles.mockImplementation(
			async (requests: ColumnProfileRequest[]): Promise<ColumnProfileResult[]> => {
				if (callIndex++ === 0) {
					signalFirstChunkStarted();
					await firstChunkGate;
				}
				return requests.map(r => ({ null_count: r.column_index }));
			}
		);

		// First window: columns 0-15 (two chunks). Not awaited -- it parks on the first chunk.
		const firstPass = cache.update({ invalidateCache: true, columnIndices: range(0, 16) });
		await firstChunkStarted;

		// The user scrolls to a new window (100-115) while the first pass is parked, cancelling it.
		await cache.update({ invalidateCache: false, columnIndices: range(100, 16) });

		// Release the first window's in-flight chunk; its result must be discarded and its second
		// chunk never requested.
		releaseFirstChunk();
		await firstPass;

		const requestedIndices = getColumnProfiles.mock.calls.flatMap(
			call => (call[0] as ColumnProfileRequest[]).map(r => r.column_index)
		);

		// Count requests rather than look for a particular column: the first window's columns all
		// go out together in the null-count request, so what says the pass stopped is that it
		// never sent a second request of its own.
		const firstWindowRequests = getColumnProfiles.mock.calls.filter(
			call => (call[0] as ColumnProfileRequest[]).some(r => r.column_index < 16)
		).length;

		expect({
			firstWindowInFlightDiscarded: cache.getColumnProfile(0),
			firstWindowRequests,
			secondWindowRequested: requestedIndices.includes(100),
			secondWindowCached: cache.getColumnProfile(100)?.null_count,
		}).toEqual({
			firstWindowInFlightDiscarded: undefined,
			firstWindowRequests: 1,
			secondWindowRequested: true,
			secondWindowCached: 100,
		});
	});
});
