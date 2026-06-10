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
	ColumnProfileType,
	SchemaUpdateEvent,
	SupportStatus,
	TableSchema
} from '../../../languageRuntime/common/positronDataExplorerComm.js';

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
});
