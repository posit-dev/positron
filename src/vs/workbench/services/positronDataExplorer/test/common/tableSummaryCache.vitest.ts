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

/** Builds an array of `count` consecutive column indices starting at `start`. */
function range(start: number, count: number): number[] {
	return Array.from({ length: count }, (_, i) => start + i);
}

/**
 * Builds a backend state with the given column count. Neither histograms nor frequency tables are
 * advertised as supported, so the cache only requests null-count profiles -- keeping the profile
 * request shape irrelevant to these tests.
 */
function backendState(numColumns: number): BackendState {
	const profilesFeature = {
		support_status: SupportStatus.Supported,
		supported_types: [{
			profile_type: ColumnProfileType.NullCount,
			support_status: SupportStatus.Supported
		}]
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
	let cache: TableSummaryCache;

	beforeEach(() => {
		const state = backendState(10_000);

		// Resolve schema for exactly the requested indices.
		getSchema = vi.fn(async (indices: number[]): Promise<TableSchema> => ({
			columns: indices.map(i => getColumnSchema(`col${i}`, i, 'number', ColumnDisplayType.Floating))
		}));
		getColumnProfiles = vi.fn().mockResolvedValue([]);

		const client: Partial<DataExplorerClientInstance> = {
			onDidSchemaUpdate: new Emitter<SchemaUpdateEvent>().event,
			onDidDataUpdate: new Emitter<void>().event,
			onDidUpdateBackendState: new Emitter<BackendState>().event,
			getBackendState: vi.fn().mockResolvedValue(state),
			getSupportedFeatures: vi.fn().mockReturnValue(state.supported_features),
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

	it('loads profiles in chunks, revealing them progressively', async () => {
		getColumnProfiles.mockImplementation(
			async (requests: ColumnProfileRequest[]): Promise<ColumnProfileResult[]> =>
				requests.map(r => ({ null_count: r.column_index }))
		);

		// Count the onDidUpdate events: one fires after the schema loads, then one per profile chunk.
		let updateFires = 0;
		const listener = cache.onDidUpdate(() => updateFires++);

		// 20 columns with a chunk size of 8 -> three chunks of 8, 8, 4.
		await cache.update({ invalidateCache: true, columnIndices: range(0, 20) });
		listener.dispose();

		const cachedProfiles = range(0, 20).filter(i => cache.getColumnProfile(i) !== undefined).length;

		expect({
			chunkRequestSizes: getColumnProfiles.mock.calls.map(call => (call[0] as ColumnProfileRequest[]).length),
			cachedProfiles,
			updateFires,
		}).toEqual({
			chunkRequestSizes: [8, 8, 4],
			cachedProfiles: 20,
			updateFires: 4,
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

		expect({
			firstWindowInFlightDiscarded: cache.getColumnProfile(0),
			firstWindowSecondChunkRequested: requestedIndices.includes(8),
			secondWindowRequested: requestedIndices.includes(100),
			secondWindowCached: cache.getColumnProfile(100)?.null_count,
		}).toEqual({
			firstWindowInFlightDiscarded: undefined,
			firstWindowSecondChunkRequested: false,
			secondWindowRequested: true,
			secondWindowCached: 100,
		});
	});
});
