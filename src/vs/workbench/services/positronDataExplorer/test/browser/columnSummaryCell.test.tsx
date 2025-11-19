/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import assert from 'assert';
import sinon from 'sinon';
import { createRoot, Root } from 'react-dom/client';
import { mainWindow } from '../../../../../base/browser/window.js';

import { ColumnSummaryCell } from '../../browser/components/columnSummaryCell.js';
import { getColumnSchema } from '../../common/positronDataExplorerMocks.js';
import { ColumnDisplayType, SupportStatus, ColumnProfileType, SupportedFeatures } from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { TableSummaryDataGridInstance } from '../../browser/tableSummaryDataGridInstance.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { PositronActionBarHoverManager } from '../../../../../platform/positronActionBar/browser/positronActionBarHoverManager.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';

/**
 * Creates a minimal mock of TableSummaryDataGridInstance
 */
function createMockTableSummaryDataGridInstance(overrides: Partial<TableSummaryDataGridInstance> = {}): TableSummaryDataGridInstance {
	// Mock the hover manager
	const mockHoverManager: Partial<PositronActionBarHoverManager> = {
		showHover: sinon.stub(),
		hideHover: sinon.stub()
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

suite('ColumnSummaryCell', () => {
	let root: Root;
	let container: HTMLElement;
	const columnSchema = getColumnSchema('test_column', 0, 'string', ColumnDisplayType.String);

	setup(() => {
		// Create a container element for React to render into
		container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		root = createRoot(container);
	});

	teardown(() => {
		// Clean up the React root and container
		if (root) {
			root.unmount();
		}
		if (container && container.parentNode) {
			container.parentNode.removeChild(container);
		}
		// Restore spies and stubs
		sinon.restore();
	});

	test('displays 0% when getColumnProfileNullPercent return 0', async () => {
		const mockTableSummaryDataGridInstance = createMockTableSummaryDataGridInstance({
			getColumnProfileNullPercent: () => 0,
			getColumnProfileNullCount: () => 0,
		});

		root.render(
			<ColumnSummaryCell
				columnIndex={0}
				columnSchema={columnSchema}
				instance={mockTableSummaryDataGridInstance}
				onDoubleClick={() => { }}
			/>
		);

		// Wait for initial render
		await new Promise(resolve => setTimeout(resolve, 0));

		const nullPercentElement = container.querySelector('.text-percent');
		assert.ok(nullPercentElement, 'Expected to find null percent element');
		assert.strictEqual(nullPercentElement.textContent, '0%', 'Expected to find 0% for 0% input');
	});

	test('displays <1% when getColumnProfileNullPercent returns 0.5', async () => {
		const mockTableSummaryDataGridInstance = createMockTableSummaryDataGridInstance({
			getColumnProfileNullPercent: () => 0.5,
			getColumnProfileNullCount: () => 1,
		});

		root.render(
			<ColumnSummaryCell
				columnIndex={0}
				columnSchema={columnSchema}
				instance={mockTableSummaryDataGridInstance}
				onDoubleClick={() => { }}
			/>
		);

		// Wait for initial render
		await new Promise(resolve => setTimeout(resolve, 0));

		const nullPercentElement = container.querySelector('.text-percent');
		assert.ok(nullPercentElement, 'Expected to find null percent element');
		assert.strictEqual(nullPercentElement.textContent, '<1%', 'Expected to find <1% for 0.5% input');
	});

	test('displays 99% when getColumnProfileNullPercent returns 99.9', async () => {
		const mockTableSummaryDataGridInstance = createMockTableSummaryDataGridInstance({
			getColumnProfileNullPercent: () => 99.9,
			getColumnProfileNullCount: () => 999,
		});

		root.render(
			<ColumnSummaryCell
				columnIndex={0}
				columnSchema={columnSchema}
				instance={mockTableSummaryDataGridInstance}
				onDoubleClick={() => { }}
			/>
		);

		// Wait for initial render
		await new Promise(resolve => setTimeout(resolve, 0));

		const nullPercentElement = container.querySelector('.text-percent');
		assert.ok(nullPercentElement, 'Expected to find null percent element');
		assert.strictEqual(nullPercentElement.textContent, '99%', 'Expected to find 99% for 99.9% input');
	});

	test('displays 100% when getColumnProfileNullPercent returns 100', async () => {
		const mockTableSummaryDataGridInstance = createMockTableSummaryDataGridInstance({
			getColumnProfileNullPercent: () => 100,
			getColumnProfileNullCount: () => 1000,
		});

		root.render(
			<ColumnSummaryCell
				columnIndex={0}
				columnSchema={columnSchema}
				instance={mockTableSummaryDataGridInstance}
				onDoubleClick={() => { }}
			/>
		);

		// Wait for initial render
		await new Promise(resolve => setTimeout(resolve, 0));

		const nullPercentElement = container.querySelector('.text-percent');
		assert.ok(nullPercentElement, 'Expected to find null percent element');
		assert.strictEqual(nullPercentElement.textContent, '100%', 'Expected to find 100% for 100% input');
	});

	// Ensure that all disposables are cleaned up.
	ensureNoDisposablesAreLeakedInTestSuite();
});
