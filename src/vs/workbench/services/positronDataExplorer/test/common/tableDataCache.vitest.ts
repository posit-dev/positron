/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { InvalidateCacheFlags, TableDataCache } from '../../common/tableDataCache.js';
import { getColumnSchema } from '../../common/positronDataExplorerMocks.js';
import { DataExplorerClientInstance } from '../../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import {
	BackendState,
	ColumnDisplayType,
	ColumnSelection,
	SupportStatus,
	TableData,
	TableRowLabels,
	TableSchema
} from '../../../languageRuntime/common/positronDataExplorerComm.js';

/**
 * Builds a backend state advertising `has_row_labels`, as a matrix with row names does. The cache
 * only reads the table shape and this flag, so the rest is filler.
 */
function backendState(hasRowLabels: boolean): BackendState {
	return {
		display_name: 'test-table',
		table_shape: { num_rows: 100, num_columns: 2 },
		table_unfiltered_shape: { num_rows: 100, num_columns: 2 },
		has_row_labels: hasRowLabels,
		column_filters: [],
		row_filters: [],
		sort_keys: [],
		supported_features: {
			search_schema: { support_status: SupportStatus.Supported, supported_types: [] },
			set_column_filters: { support_status: SupportStatus.Supported, supported_types: [] },
			set_row_filters: { support_status: SupportStatus.Supported, supports_conditions: SupportStatus.Supported, supported_types: [] },
			get_column_profiles: { support_status: SupportStatus.Supported, supported_types: [] },
			export_data_selection: { support_status: SupportStatus.Supported, supported_formats: [] },
			set_sort_columns: { support_status: SupportStatus.Supported },
			convert_to_code: { support_status: SupportStatus.Supported }
		}
	};
}

describe('TableDataCache', () => {
	let getBackendState: ReturnType<typeof vi.fn>;
	let getRowLabels: ReturnType<typeof vi.fn>;
	let getDataValues: ReturnType<typeof vi.fn>;
	let cache: TableDataCache;

	beforeEach(() => {
		const state = backendState(true);

		getBackendState = vi.fn().mockResolvedValue(state);
		// Resolve schema for exactly the requested indices.
		const getSchema = vi.fn(async (indices: number[]): Promise<TableSchema> => ({
			columns: indices.map(i => getColumnSchema(`col${i}`, i, 'number', ColumnDisplayType.Floating))
		}));
		// Return one formatted value per requested cell so the data cache is populated.
		getDataValues = vi.fn(async (columns: ColumnSelection[]): Promise<TableData> => ({
			columns: columns.map(() => ['1'])
		}));
		// Return one row label per selection.
		getRowLabels = vi.fn(async (): Promise<TableRowLabels> => ({ row_labels: [['A']] }));

		const client: Partial<DataExplorerClientInstance> = {
			getBackendState: getBackendState as DataExplorerClientInstance['getBackendState'],
			getSchema: getSchema as DataExplorerClientInstance['getSchema'],
			getDataValues: getDataValues as DataExplorerClientInstance['getDataValues'],
			getRowLabels: getRowLabels as DataExplorerClientInstance['getRowLabels'],
		};

		cache = new TableDataCache(client as DataExplorerClientInstance);
	});

	afterEach(() => {
		cache.dispose();
	});

	it('keeps processing updates after a rejected row-labels request', async () => {
		ensureNoLeakedDisposables();

		// The first update's row-labels fetch rejects. This used to throw out of update() before the
		// updating flag was cleared, permanently wedging the cache so every later update parked itself
		// behind the in-progress guard and the grid never repainted (posit-dev/positron#12547).
		getRowLabels.mockRejectedValueOnce(new Error('row.names should be strings, got 0'));

		await cache.update({ invalidateCache: InvalidateCacheFlags.Data, columnIndices: [0, 1], rowIndices: [0, 1] });

		// Despite the failure, a subsequent update (as the user scrolls) is processed rather than
		// silently dropped, and its data and row labels are cached.
		await cache.update({ invalidateCache: InvalidateCacheFlags.Data, columnIndices: [0, 1], rowIndices: [0, 1] });

		expect({
			dataCached: cache.getDataCell(0, 0)?.formatted,
			rowLabelCached: cache.getRowLabel(0),
			rowLabelRequests: getRowLabels.mock.calls.length,
		}).toEqual({
			dataCached: '1',
			rowLabelCached: 'A',
			rowLabelRequests: 2,
		});
	});

	it('drains the pending update queued while the in-flight update fails', async () => {
		ensureNoLeakedDisposables();

		// This is the actual #12547 flow. On open, the first cache update runs before the viewport
		// rows are laid out and fails; while it is in flight the real viewport update arrives and parks
		// as the pending descriptor. Before the fix, the failure left the updating flag stuck and the
		// pending update never ran, so the grid stayed blank. The recovery must happen through the
		// pending-descriptor drain, not a fresh caller-driven update.

		// Gate the first update's backend-state fetch so the second update arrives while it is parked.
		let signalFirstStarted!: () => void;
		const firstStarted = new Promise<void>(resolve => { signalFirstStarted = resolve; });
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });

		let callIndex = 0;
		getBackendState.mockImplementation(async () => {
			if (callIndex++ === 0) {
				signalFirstStarted();
				await firstGate;
			}
			return backendState(true);
		});
		// The first (in-flight) update fails on its row-labels fetch; the pending update then succeeds.
		getRowLabels.mockRejectedValueOnce(new Error('row.names should be strings, got 0'));

		// First update: parks on the gated backend-state fetch. Not awaited yet.
		const firstPass = cache.update({ invalidateCache: InvalidateCacheFlags.Data, columnIndices: [0, 1], rowIndices: [0, 1] });
		await firstStarted;

		// Second update arrives while the first is in flight, so it parks as the pending descriptor.
		void cache.update({ invalidateCache: InvalidateCacheFlags.Data, columnIndices: [0, 1], rowIndices: [2, 3] });

		// Let the first update finish and fail; the pending second update must drain and load its data.
		releaseFirst();
		await firstPass;

		expect({
			pendingUpdateData: cache.getDataCell(0, 2)?.formatted,
			pendingUpdateLabel: cache.getRowLabel(2),
			rowLabelRequests: getRowLabels.mock.calls.length,
		}).toEqual({
			pendingUpdateData: '1',
			pendingUpdateLabel: 'A',
			rowLabelRequests: 2,
		});
	});

	it('does not request row labels when the row selection is empty', async () => {
		ensureNoLeakedDisposables();

		// On open, the first cache update runs before the viewport rows are laid out, so it carries an
		// empty row selection. Sending get_row_labels with { indices: [] } is what the backend rejects,
		// so the cache must not issue that request at all.
		await cache.update({ invalidateCache: InvalidateCacheFlags.Data, columnIndices: [0, 1], rowIndices: [] });

		expect(getRowLabels).not.toHaveBeenCalled();
	});
});
