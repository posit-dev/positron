/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { TableSummaryDataGridInstance } from '../../browser/tableSummaryDataGridInstance.js';
import { TableSummaryCache } from '../../common/tableSummaryCache.js';
import { DataExplorerClientInstance } from '../../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
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
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { getColumnSchema } from '../../common/positronDataExplorerMocks.js';

describe('TableSummaryDataGridInstance', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IConfigurationService, new TestConfigurationService())
		.stub(IHoverService, NullHoverService)
		.build();

	let instance: TableSummaryDataGridInstance;
	let mockTableSummaryCache: TableSummaryCache;

	// Pre-configured stubs for easier testing
	let isColumnExpandedStub: ReturnType<typeof vi.fn>;
	let getColumnSchemaStub: ReturnType<typeof vi.fn>;
	let getColumnProfileStub: ReturnType<typeof vi.fn>;
	let toggleExpandColumnStub: ReturnType<typeof vi.fn>;

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

	beforeEach(() => {
		// TableSummaryDataGridInstance reads PositronReactServices.services
		// (static singleton) in its constructor. Bridge the builder-configured
		// DI container to the singleton so the services stubbed above flow
		// through to the instance under test.
		PositronReactServices.services = ctx.reactServices;

		// Create pre-configured stubs
		isColumnExpandedStub = vi.fn().mockReturnValue(false);
		getColumnSchemaStub = vi.fn();
		getColumnProfileStub = vi.fn();
		toggleExpandColumnStub = vi.fn().mockResolvedValue(undefined);

		// Create mock data explorer client
		const mockDataExplorerClient: Partial<DataExplorerClientInstance> = {
			onDidSchemaUpdate: new Emitter<SchemaUpdateEvent>().event,
			onDidDataUpdate: new Emitter<void>().event,
			onDidUpdateBackendState: new Emitter<BackendState>().event,
			getBackendState: vi.fn().mockResolvedValue(mockBackendState),
			searchSchema2: vi.fn().mockResolvedValue({ matches: [0, 1, 2] }),
			getSupportedFeatures: vi.fn().mockReturnValue(mockBackendState.supported_features),
			dispose: vi.fn()
		};

		// Create mock table summary cache
		const partialMockTableSummaryCache: Partial<TableSummaryCache> = {
			columns: 10,
			rows: 100,
			isColumnExpanded: isColumnExpandedStub,
			getColumnSchema: getColumnSchemaStub,
			getColumnProfile: getColumnProfileStub,
			toggleExpandColumn: toggleExpandColumnStub,
			onDidUpdate: new Emitter<void>().event,
			update: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn()
		};
		mockTableSummaryCache = partialMockTableSummaryCache as TableSummaryCache;

		// Create the instance
		instance = new TableSummaryDataGridInstance(
			mockDataExplorerClient as DataExplorerClientInstance,
			mockTableSummaryCache as TableSummaryCache,
		);
	});

	afterEach(() => {
		instance.dispose();
	});

	it('columns should always return 1', () => {
		expect(instance.columns).toBe(1);
	});

	it('rows should return column count', () => {
		expect(instance.rows).toBe(10);
	});

	it('setSearchText should trigger fetchData', async () => {
		const spy = vi.spyOn(instance, 'fetchData');
		await instance.setSearchText('test');
		expect(spy).toHaveBeenCalled();
	});

	it('setSortOption should trigger fetchData', async () => {
		const spy = vi.spyOn(instance, 'fetchData');
		await instance.setSortOption(SearchSchemaSortOrder.DescendingName);
		expect(spy).toHaveBeenCalled();
	});

	it('isColumnExpanded should delegate to cache', () => {
		isColumnExpandedStub.mockReturnValue(true);
		expect(instance.isColumnExpanded(5)).toBe(true);
		expect(isColumnExpandedStub).toHaveBeenCalledWith(5);
	});

	it('canToggleColumnExpansion should return false for unsupported column types', () => {
		const unsupportedColumnSchema = getColumnSchema('test', 0, 'unknown', ColumnDisplayType.Unknown);
		getColumnSchemaStub.mockReturnValue(unsupportedColumnSchema);
		expect(instance.canToggleColumnExpansion(0)).toBe(false);
	});

	it('canToggleColumnExpansion should return true for supported column types when feature is enabled', () => {
		const supportedColumnSchema = getColumnSchema('test', 0, 'number', ColumnDisplayType.Floating);
		getColumnSchemaStub.mockReturnValue(supportedColumnSchema);
		expect(instance.canToggleColumnExpansion(0)).toBe(true);
	});

	it('toggleExpandColumn should update row layout manager', async () => {
		const supportedColumnSchema = getColumnSchema('test', 0, 'number', ColumnDisplayType.Floating);
		getColumnSchemaStub.mockReturnValue(supportedColumnSchema);
		await instance.toggleExpandColumn(0);
		expect(toggleExpandColumnStub).toHaveBeenCalledWith(0);
	});

	it('getColumnProfileNullCount should delegate to cache', () => {
		const mockProfile = { null_count: 5 };
		getColumnProfileStub.mockReturnValue(mockProfile);
		const result = instance.getColumnProfileNullCount(0);
		expect(result).toBe(5);
		expect(getColumnProfileStub).toHaveBeenCalledWith(0);
	});

});
