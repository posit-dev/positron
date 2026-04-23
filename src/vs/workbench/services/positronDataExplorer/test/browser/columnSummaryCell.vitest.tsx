/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ColumnSummaryCell } from '../../browser/components/columnSummaryCell.js';
import { getColumnSchema } from '../../common/positronDataExplorerMocks.js';
import { ColumnDisplayType, SupportStatus, ColumnProfileType, SupportedFeatures } from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { TableSummaryDataGridInstance } from '../../browser/tableSummaryDataGridInstance.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { PositronActionBarHoverManager } from '../../../../../platform/positronActionBar/browser/positronActionBarHoverManager.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';

/**
 * Creates a minimal mock of TableSummaryDataGridInstance
 */
function createMockTableSummaryDataGridInstance(overrides: Partial<TableSummaryDataGridInstance> = {}): TableSummaryDataGridInstance {
	// Mock the hover manager
	const mockHoverManager: Partial<PositronActionBarHoverManager> = {
		showHover: vi.fn(),
		hideHover: vi.fn()
	};

	// Mock the configuration service
	const mockConfigurationService: Partial<IConfigurationService> = {};

	const mockSupportedFeatures: SupportedFeatures = {
		get_column_profiles: {
			support_status: SupportStatus.Supported,
			supported_types: [
				{
					profile_type: ColumnProfileType.NullCount,
					support_status: SupportStatus.Supported
				}
			]
		},
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
			supported_types: [],
			supports_conditions: SupportStatus.Supported
		},
		set_sort_columns: {
			support_status: SupportStatus.Supported
		},
		export_data_selection: {
			support_status: SupportStatus.Supported,
			supported_formats: []
		},
		convert_to_code: {
			support_status: SupportStatus.Supported
		}
	};

	const mockTableSummaryDataGridInstance: Partial<TableSummaryDataGridInstance> = {
		cursorRowIndex: 0,
		focused: false,

		// Methods the component calls
		getSupportedFeatures: () => mockSupportedFeatures,
		getColumnProfileNullPercent: () => undefined,
		getColumnProfileNullCount: () => undefined,
		getColumnProfileSmallHistogram: () => undefined,
		getColumnProfileSmallFrequencyTable: () => undefined,
		isColumnExpanded: () => false,
		canToggleColumnExpansion: () => true,
		isSummaryStatsSupported: () => true,
		scrollToRow: async () => { },
		setCursorRow: () => { },
		toggleExpandColumn: async () => { },

		// Mock hover manager with basic methods
		hoverManager: mockHoverManager as PositronActionBarHoverManager,
		// Mock configuration service
		configurationService: mockConfigurationService as IConfigurationService,

		// Apply any overrides from the test
		...overrides
	};

	return mockTableSummaryDataGridInstance as TableSummaryDataGridInstance;
}

describe('ColumnSummaryCell', () => {
	const rtl = setupRTLRenderer();

	const columnSchema = getColumnSchema('test_column', 0, 'string', ColumnDisplayType.String);

	function renderRoot(
		mockTableSummaryDataGridInstance: TableSummaryDataGridInstance,
	) {
		return rtl.render(
			<ColumnSummaryCell
				columnIndex={0}
				columnSchema={columnSchema}
				instance={mockTableSummaryDataGridInstance}
				onDoubleClick={() => { }}
			/>
		);
	}

	it('displays 0% when getColumnProfileNullPercent return 0', async () => {
		const mockTableSummaryDataGridInstance = createMockTableSummaryDataGridInstance({
			getColumnProfileNullPercent: () => 0,
			getColumnProfileNullCount: () => 0,
		});

		const { getByText } = renderRoot(mockTableSummaryDataGridInstance);

		// Showcase preserves the destructure-from-render pattern (Dhruvi's reviewer
		// suggestion) plus the getByText selector form; the result is wrapped in
		// expect().toBeInTheDocument() per the current explicit-assert convention.
		// eslint-disable-next-line testing-library/prefer-screen-queries
		expect(getByText('0%', { selector: '.text-percent' })).toBeInTheDocument();
	});

	it('displays <1% when getColumnProfileNullPercent returns 0.5', async () => {
		const mockTableSummaryDataGridInstance = createMockTableSummaryDataGridInstance({
			getColumnProfileNullPercent: () => 0.5,
			getColumnProfileNullCount: () => 1,
		});

		const { getByText } = renderRoot(mockTableSummaryDataGridInstance);

		// Showcase preserves the destructure-from-render pattern (Dhruvi's reviewer
		// suggestion) plus the getByText selector form; the result is wrapped in
		// expect().toBeInTheDocument() per the current explicit-assert convention.
		// eslint-disable-next-line testing-library/prefer-screen-queries
		expect(getByText('<1%', { selector: '.text-percent' })).toBeInTheDocument();
	});

	it('displays 99% when getColumnProfileNullPercent returns 99.9', async () => {
		const mockTableSummaryDataGridInstance = createMockTableSummaryDataGridInstance({
			getColumnProfileNullPercent: () => 99.9,
			getColumnProfileNullCount: () => 999,
		});

		const { getByText } = renderRoot(mockTableSummaryDataGridInstance);

		// Showcase preserves the destructure-from-render pattern (Dhruvi's reviewer
		// suggestion) plus the getByText selector form; the result is wrapped in
		// expect().toBeInTheDocument() per the current explicit-assert convention.
		// eslint-disable-next-line testing-library/prefer-screen-queries
		expect(getByText('99%', { selector: '.text-percent' })).toBeInTheDocument();
	});

	it('displays 100% when getColumnProfileNullPercent returns 100', async () => {
		const mockTableSummaryDataGridInstance = createMockTableSummaryDataGridInstance({
			getColumnProfileNullPercent: () => 100,
			getColumnProfileNullCount: () => 1000,
		});

		const { getByText } = renderRoot(mockTableSummaryDataGridInstance);

		// Showcase preserves the destructure-from-render pattern (Dhruvi's reviewer
		// suggestion) plus the getByText selector form; the result is wrapped in
		// expect().toBeInTheDocument() per the current explicit-assert convention.
		// eslint-disable-next-line testing-library/prefer-screen-queries
		expect(getByText('100%', { selector: '.text-percent' })).toBeInTheDocument();
	});

});
