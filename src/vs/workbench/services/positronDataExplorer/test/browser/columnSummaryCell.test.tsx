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
import { ColumnDisplayType, SupportStatus, ColumnProfileType } from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { TableSummaryDataGridInstance } from '../../browser/tableSummaryDataGridInstance.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

export function createMockTableSummaryDataGridInstance(overrides = {}): TableSummaryDataGridInstance {
	// Mock the hover manager
	const mockHoverManager = {
		showHover: sinon.stub(),
		hideHover: sinon.stub()
	};

	// Mock the configuration service
	const mockConfigurationService = {};

	// Mock supported features
	const mockSupportedFeatures = {
		get_column_profiles: {
			support_status: SupportStatus.Supported,
			supported_types: [
				{
					profile_type: ColumnProfileType.SummaryStats,
					support_status: SupportStatus.Supported
				},
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
			supported_types: []
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

	// Mock instance of TableSummaryDataGridInstance
	const mockInstance = {
		// Mock properties from DataGridInstance base class
		cursorRowIndex: 0,
		focused: false,
		// Mock methods from DataGridInstance base class
		scrollToRow: sinon.stub().resolves(),
		setCursorRow: sinon.stub(),
		// Mock properties from TableSummaryDataGridInstance
		hoverManager: mockHoverManager,
		configurationService: mockConfigurationService,
		// Mock methods from TableSummaryDataGridInstance
		getSupportedFeatures: sinon.stub().returns(mockSupportedFeatures),
		isColumnExpanded: sinon.stub().returns(false),
		toggleExpandColumn: sinon.stub().resolves(),
		getColumnProfileNullCount: sinon.stub().returns(undefined),
		getColumnProfileNullPercent: sinon.stub().returns(undefined),
		getColumnProfileSummaryStats: sinon.stub().returns(undefined),
		getColumnProfileSmallHistogram: sinon.stub().returns(undefined),
		getColumnProfileLargeHistogram: sinon.stub().returns(undefined),
		getColumnProfileSmallFrequencyTable: sinon.stub().returns(undefined),
		getColumnProfileLargeFrequencyTable: sinon.stub().returns(undefined),
		...overrides
	};

	return mockInstance as unknown as TableSummaryDataGridInstance;
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
			getColumnProfileNullPercent: sinon.stub().returns(0),
			getColumnProfileNullCount: sinon.stub().returns(0),
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
			getColumnProfileNullPercent: sinon.stub().returns(0.5),
			getColumnProfileNullCount: sinon.stub().returns(1),
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

	// Ensure that all disposables are cleaned up.
	ensureNoDisposablesAreLeakedInTestSuite();
});
