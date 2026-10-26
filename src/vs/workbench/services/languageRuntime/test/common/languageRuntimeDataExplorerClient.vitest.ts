/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DeferredPromise } from '../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { IDataExplorerResponseDto, IDataExplorerRpcDto, IDataExplorerRpcTransport } from '../../../positronDataExplorer/common/dataExplorerRpcTransport.js';
import { PositronDataExplorerExtensionBackend } from '../../../positronDataExplorer/common/positronDataExplorerExtensionBackend.js';
import { DataExplorerClientInstance } from '../../common/languageRuntimeDataExplorerClient.js';
import { BackendState, ColumnDisplayType, ColumnSchema, ColumnSortKey, DataExplorerBackendRequest, FilterComparisonOp, GetSchemaParams, RowFilter, RowFilterCondition, RowFilterType, SetRowFiltersParams, SetSortColumnsParams, SupportedFeatures, SupportStatus } from '../../common/positronDataExplorerComm.js';

describe('DataExplorerClientInstance', () => {
	let store: DisposableStore;

	beforeEach(() => {
		ensureNoLeakedDisposables();
		store = new DisposableStore();
	});

	afterEach(() => {
		store.dispose();
	});

	it('delivers its close event to every listener when a listener disposes the client again', () => {
		const transport: IDataExplorerRpcTransport = {
			handleRpc: async () => ({ result: undefined }),
			disposeBackend: () => { },
			supportsRefresh: () => false,
			refreshDataset: async () => { },
		};
		const client = store.add(new DataExplorerClientInstance(
			new PositronDataExplorerExtensionBackend(transport, 'provider', 'dataset')
		));

		// The first listener disposes the client again, as disposing the Data Explorer instance that
		// owns the client does.
		const received: string[] = [];
		store.add(client.onDidClose(() => {
			received.push('first');
			client.dispose();
		}));
		store.add(client.onDidClose(() => received.push('second')));

		client.dispose();

		expect(received).toEqual(['first', 'second']);
	});

	describe('refresh', () => {
		/** Everything unsupported; refresh does not consult the backend's features. */
		const NO_FEATURES: SupportedFeatures = {
			search_schema: { support_status: SupportStatus.Unsupported, supported_types: [] },
			set_column_filters: { support_status: SupportStatus.Unsupported, supported_types: [] },
			set_row_filters: { support_status: SupportStatus.Unsupported, supports_conditions: SupportStatus.Unsupported, supported_types: [] },
			get_column_profiles: { support_status: SupportStatus.Unsupported, supported_types: [] },
			set_sort_columns: { support_status: SupportStatus.Unsupported },
			export_data_selection: { support_status: SupportStatus.Unsupported, supported_formats: [] },
			convert_to_code: { support_status: SupportStatus.Unsupported },
		};

		/** The schema of a table with the given columns, in order. */
		const columnsOf = (names: string[]): ColumnSchema[] => names.map((column_name, column_index) => ({
			column_name,
			column_index,
			type_name: 'TEXT',
			type_display: ColumnDisplayType.String,
		}));

		/** A filter keeping rows whose column equals 'x'. */
		const filterOn = (column: ColumnSchema): RowFilter => ({
			filter_id: `filter-${column.column_name}`,
			filter_type: RowFilterType.Compare,
			column_schema: column,
			condition: RowFilterCondition.And,
			params: { op: FilterComparisonOp.Eq, value: 'x' },
		});

		/**
		 * A table served by a fake provider. Like the Data Connections drivers, the provider keeps its
		 * view's sort keys and row filters, and a refresh rebuilds the view over the table's current
		 * columns with neither.
		 */
		function createTable(options: {
			columns: string[];
			sortKeys?: (columns: ColumnSchema[]) => ColumnSortKey[];
			rowFilters?: (columns: ColumnSchema[]) => RowFilter[];
			columnsAfterRefresh: string[];
			refreshError?: string;
			/** Error messages for successive set_row_filters calls; undefined lets a call succeed. */
			setRowFiltersErrors?: Array<string | undefined>;
		}) {
			let columns = columnsOf(options.columns);
			let sortKeys = options.sortKeys?.(columns) ?? [];
			let rowFilters = options.rowFilters?.(columns) ?? [];
			const setRowFiltersErrors = [...options.setRowFiltersErrors ?? []];
			const calls: string[] = [];
			const sent: { sortKeys: ColumnSortKey[][]; rowFilters: RowFilter[][] } = { sortKeys: [], rowFilters: [] };

			/** Holds the next get_state response until released, when set. */
			let heldState: DeferredPromise<void> | undefined;

			const state = (): BackendState => ({
				display_name: 'people',
				table_shape: { num_rows: 10, num_columns: columns.length },
				table_unfiltered_shape: { num_rows: 10, num_columns: columns.length },
				has_row_labels: false,
				column_filters: [],
				row_filters: rowFilters,
				sort_keys: sortKeys,
				supported_features: NO_FEATURES,
			});

			const respond = async (rpc: IDataExplorerRpcDto): Promise<IDataExplorerResponseDto> => {
				switch (rpc.method) {
					case DataExplorerBackendRequest.GetState: {
						// Captured when the request arrives, as a provider answers it.
						const result = state();
						const hold = heldState;
						heldState = undefined;
						await hold?.p;
						return { result };
					}
					case DataExplorerBackendRequest.GetSchema:
						return { result: { columns: (rpc.params as GetSchemaParams).column_indices.map(index => columns[index]) } };
					case DataExplorerBackendRequest.SetSortColumns:
						calls.push(rpc.method);
						sortKeys = (rpc.params as SetSortColumnsParams).sort_keys;
						sent.sortKeys.push(sortKeys);
						return { result: undefined };
					case DataExplorerBackendRequest.SetRowFilters: {
						calls.push(rpc.method);
						const filters = (rpc.params as SetRowFiltersParams).filters;
						sent.rowFilters.push(filters);
						const error = setRowFiltersErrors.shift();
						if (error) {
							return { error_message: error };
						}
						rowFilters = filters;
						return { result: { selected_num_rows: 10 } };
					}
					default:
						return { result: undefined };
				}
			};

			const transport: IDataExplorerRpcTransport = {
				handleRpc: (_providerId, rpc) => respond(rpc),
				disposeBackend: () => { },
				supportsRefresh: () => true,
				refreshDataset: async () => {
					calls.push('refresh');
					if (options.refreshError) {
						throw new Error(options.refreshError);
					}
					columns = columnsOf(options.columnsAfterRefresh);
					sortKeys = [];
					rowFilters = [];
				},
			};

			const client = store.add(new DataExplorerClientInstance(
				new PositronDataExplorerExtensionBackend(transport, 'provider', 'dataset')
			));
			let schemaUpdates = 0;
			store.add(client.onDidSchemaUpdate(() => schemaUpdates++));

			return {
				client,
				calls,
				sent,
				get schemaUpdates() { return schemaUpdates; },
				holdNextState: () => {
					heldState = new DeferredPromise<void>();
					return heldState;
				},
			};
		}

		it('rebuilds the view and reloads, without re-applying anything when there is no sort or filter', async () => {
			const table = createTable({ columns: ['name'], columnsAfterRefresh: ['name', 'age'] });

			await table.client.refresh();

			expect({
				calls: table.calls,
				schemaUpdates: table.schemaUpdates,
				columns: table.client.cachedBackendState?.table_shape.num_columns,
			}).toEqual({ calls: ['refresh'], schemaUpdates: 1, columns: 2 });
		});

		it('re-applies sort keys by column name, dropping those whose column is gone', async () => {
			const table = createTable({
				columns: ['name', 'age', 'city'],
				sortKeys: ([, age, city]) => [
					{ column_index: city.column_index, ascending: true },
					{ column_index: age.column_index, ascending: false },
				],
				// city moves to the front, and age is gone.
				columnsAfterRefresh: ['city', 'name'],
			});

			await table.client.refresh();

			expect({
				sent: table.sent.sortKeys,
				cached: table.client.cachedBackendState?.sort_keys,
			}).toEqual({
				sent: [[{ column_index: 0, ascending: true }]],
				cached: [{ column_index: 0, ascending: true }],
			});
		});

		it('re-applies row filters by column name, keeping those whose column is gone as invalid', async () => {
			const table = createTable({
				columns: ['name', 'age'],
				rowFilters: ([name, age]) => [filterOn(name), filterOn(age)],
				// name moves, and age is gone.
				columnsAfterRefresh: ['city', 'name'],
			});

			await table.client.refresh();

			const [name] = columnsOf(['name']);
			expect(table.client.cachedBackendState?.row_filters).toEqual([
				{ ...filterOn(name), column_schema: { ...name, column_index: 1 } },
				{ ...filterOn(columnsOf(['name', 'age'])[1]), is_valid: false, error_message: 'Column was removed' },
			]);
		});

		it('applies a filter again once its column is back', async () => {
			const [, age] = columnsOf(['name', 'age']);
			const table = createTable({
				columns: ['name', 'age'],
				rowFilters: () => [{ ...filterOn(age), is_valid: false, error_message: 'Column was removed' }],
				columnsAfterRefresh: ['name', 'age'],
			});

			await table.client.refresh();

			expect(table.client.cachedBackendState?.row_filters).toEqual([filterOn(age)]);
		});

		it('keeps every filter, marked invalid, when the rebuilt view cannot apply them', async () => {
			const table = createTable({
				columns: ['name', 'age'],
				rowFilters: ([name, age]) => [filterOn(name), filterOn(age)],
				columnsAfterRefresh: ['name'],
				setRowFiltersErrors: ['type mismatch'],
			});

			await table.client.refresh();

			const [name, age] = columnsOf(['name', 'age']);
			expect(table.client.cachedBackendState?.row_filters).toEqual([
				{ ...filterOn(name), is_valid: false, error_message: 'type mismatch' },
				{ ...filterOn(age), is_valid: false, error_message: 'Column was removed' },
			]);
		});

		it('clears the filters when the rebuilt view rejects them even marked invalid', async () => {
			const table = createTable({
				columns: ['name'],
				rowFilters: ([name]) => [filterOn(name)],
				columnsAfterRefresh: ['name'],
				setRowFiltersErrors: ['type mismatch', 'still failing'],
			});

			await table.client.refresh();

			expect({
				lastSent: table.sent.rowFilters.at(-1),
				cached: table.client.cachedBackendState?.row_filters,
				schemaUpdates: table.schemaUpdates,
			}).toEqual({ lastSent: [], cached: [], schemaUpdates: 1 });
		});

		it('rejects and changes nothing when the view cannot be rebuilt', async () => {
			const table = createTable({
				columns: ['name'],
				sortKeys: ([name]) => [{ column_index: name.column_index, ascending: true }],
				rowFilters: ([name]) => [filterOn(name)],
				columnsAfterRefresh: ['name'],
				refreshError: 'table was dropped',
			});

			await expect(table.client.refresh()).rejects.toThrow('table was dropped');

			expect({ calls: table.calls, schemaUpdates: table.schemaUpdates }).toEqual({
				calls: ['refresh'],
				schemaUpdates: 0,
			});
		});

		it('reloads from the rebuilt view, not a state request made before the rebuild', async () => {
			const table = createTable({ columns: ['name'], columnsAfterRefresh: ['name', 'age'] });
			await table.client.getBackendState();

			// A state request that reaches the provider before the rebuild, and answers after it.
			const held = table.holdNextState();
			const staleRequest = table.client.updateBackendState();
			const refreshed = table.client.refresh();
			await vi.waitFor(() => expect(table.calls).toContain('refresh'));
			held.complete();
			await Promise.all([staleRequest, refreshed]);

			expect(table.client.cachedBackendState?.table_shape.num_columns).toBe(2);
		});
	});
});
