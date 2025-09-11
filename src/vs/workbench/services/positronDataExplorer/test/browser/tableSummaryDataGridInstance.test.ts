/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { Emitter } from '../../../../../base/common/event.js';
import { TableSummaryDataGridInstance } from '../../browser/tableSummaryDataGridInstance.js';
import { TableSummaryCache } from '../../common/tableSummaryCache.js';
import { DataExplorerClientInstance } from '../../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import {
	ColumnDisplayType,
	SearchSchemaSortOrder,
	BackendState,
	ColumnProfileType,
	SupportStatus,
	SchemaUpdateEvent
} from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { getColumnSchema } from '../../common/positronDataExplorerMocks.js';

suite('TableSummaryDataGridInstance', () => {
	let instance: TableSummaryDataGridInstance;
	let mockTableSummaryCache: TableSummaryCache;
	let sandbox: sinon.SinonSandbox;
	let originalServices: any;

	// Mock backend state
	const mockBackendState: BackendState = {
		display_name: 'test-table',
		table_shape: { num_rows: 100, num_columns: 10 },
		table_unfiltered_shape: { num_rows: 100, num_columns: 10 },
		has_row_labels: false,
		column_filters: [],
		row_filters: [],
		sort_keys: [],
		supported_features: {
			search_schema: {
				support_status: SupportStatus.Supported,
				supported_types: []
			},
			set_column_filters: {
				support_status: SupportStatus.Supported,
				supported_types: []
			},
			set_row_filters: {
				support_status: SupportStatus.Supported,
				supports_conditions: SupportStatus.Supported,
				supported_types: []
			},
			get_column_profiles: {
				support_status: SupportStatus.Supported,
				supported_types: [
					{
						profile_type: ColumnProfileType.SummaryStats,
						support_status: SupportStatus.Supported
					}
				]
			},
			export_data_selection: {
				support_status: SupportStatus.Supported,
				supported_formats: []
			},
			set_sort_columns: {
				support_status: SupportStatus.Supported
			},
			convert_to_code: {
				support_status: SupportStatus.Supported
			}
		}
	};

	setup(() => {
		sandbox = sinon.createSandbox();

		// Store original services to restore later
		originalServices = PositronReactServices.services;

		// Mock PositronReactServices.services
		const mockServices: Partial<PositronReactServices> = {
			configurationService: new TestConfigurationService(),
			hoverService: NullHoverService
		};
		PositronReactServices.services = mockServices as PositronReactServices;

		// Create mock data explorer client
		const mockDataExplorerClient: Partial<DataExplorerClientInstance> = {
			onDidSchemaUpdate: new Emitter<SchemaUpdateEvent>().event,
			onDidDataUpdate: new Emitter<void>().event,
			onDidUpdateBackendState: new Emitter<BackendState>().event,
			getBackendState: sandbox.stub().resolves(mockBackendState),
			searchSchema2: sandbox.stub().resolves({ matches: [0, 1, 2] }),
			getSupportedFeatures: sandbox.stub().returns(mockBackendState.supported_features),
			dispose: sandbox.stub()
		};

		// Create mock table summary cache
		const partialMockTableSummaryCache: Partial<TableSummaryCache> = {
			columns: 10,
			rows: 100,
			isColumnExpanded: sandbox.stub().returns(false),
			getColumnSchema: sandbox.stub(),
			getColumnProfile: sandbox.stub(),
			toggleExpandColumn: sandbox.stub().resolves(),
			onDidUpdate: new Emitter<void>().event,
			update: sandbox.stub().resolves(),
			dispose: sandbox.stub()
		};
		mockTableSummaryCache = partialMockTableSummaryCache as TableSummaryCache;

		// Create the instance
		instance = new TableSummaryDataGridInstance(
			mockDataExplorerClient as DataExplorerClientInstance,
			mockTableSummaryCache as TableSummaryCache,
		);
	});

	teardown(() => {
		instance.dispose();
		// Restore original services
		if (originalServices) {
			PositronReactServices.services = originalServices;
		}
		sandbox.restore();
	});

	test('columns should always return 1', () => {
		assert.strictEqual(instance.columns, 1);
	});

	test('rows should return cache columns count', () => {
		assert.strictEqual(instance.rows, 10);
	});

	test('setSearchText should trigger layout update', async () => {
		const spy = sandbox.spy(instance, 'fetchData');
		await instance.setSearchText('test');
		assert(spy.called);
	});

	test('setSortOption should trigger layout update', async () => {
		const spy = sandbox.spy(instance, 'fetchData');
		await instance.setSortOption(SearchSchemaSortOrder.DescendingName);
		assert(spy.called);
	});

	test('isColumnExpanded should delegate to cache', () => {
		(mockTableSummaryCache.isColumnExpanded as sinon.SinonStub).returns(true);
		assert.strictEqual(instance.isColumnExpanded(5), true);
		assert((mockTableSummaryCache.isColumnExpanded as sinon.SinonStub).calledWith(5));
	});

	test('canToggleColumnExpansion should return false for unsupported column types', () => {
		const unsupportedColumnSchema = getColumnSchema('test', 0, 'unknown', ColumnDisplayType.Unknown);
		(mockTableSummaryCache.getColumnSchema as sinon.SinonStub).returns(unsupportedColumnSchema);
		assert.strictEqual(instance.canToggleColumnExpansion(0), false);
	});

	test('canToggleColumnExpansion should return true for supported column types when feature is enabled', () => {
		const supportedColumnSchema = getColumnSchema('test', 0, 'number', ColumnDisplayType.Number);
		(mockTableSummaryCache.getColumnSchema as sinon.SinonStub).returns(supportedColumnSchema);
		assert.strictEqual(instance.canToggleColumnExpansion(0), true);
	});

	test('toggleExpandColumn should update row layout manager', async () => {
		const supportedColumnSchema = getColumnSchema('test', 0, 'number', ColumnDisplayType.Number);
		(mockTableSummaryCache.getColumnSchema as sinon.SinonStub).returns(supportedColumnSchema);
		await instance.toggleExpandColumn(0);
		assert((mockTableSummaryCache.toggleExpandColumn as sinon.SinonStub).calledWith(0));
	});

	test('getColumnProfileNullCount should delegate to cache', () => {
		const mockProfile = { null_count: 5 };
		(mockTableSummaryCache.getColumnProfile as sinon.SinonStub).returns(mockProfile);
		const result = instance.getColumnProfileNullCount(0);
		assert.strictEqual(result, 5);
		assert((mockTableSummaryCache.getColumnProfile as sinon.SinonStub).calledWith(0));
	});

	// Ensure that all disposables are cleaned up.
	ensureNoDisposablesAreLeakedInTestSuite();
});
