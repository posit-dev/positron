/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import assert from 'assert';
import sinon from 'sinon';
import { createRoot } from 'react-dom/client';
import { mainWindow } from '../../../../../base/browser/window.js';

import { ColumnSummaryCell } from '../../browser/components/columnSummaryCell.js';
import { mockObject } from '../../../../../base/test/common/mock.js';
import { getColumnSchema } from '../../common/positronDataExplorerMocks.js';
import { ColumnDisplayType, ColumnProfileType } from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { TableSummaryDataGridInstance } from '../../browser/tableSummaryDataGridInstance.js';
import { PositronDataGridContextProvider } from '../../../../browser/positronDataGrid/positronDataGridContext.js';

suite('ColumnSummaryCell', () => {
	let mockInstance: any;
	let mockConfigurationService: any;
	let mockHoverManager: any;
	let container: HTMLElement;
	let root: any;

	setup(() => {
		// Create a container element for React to render into
		container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		root = createRoot(container);

		// Create minimal mocks for the required services
		mockConfigurationService = mockObject()();
		mockHoverManager = mockObject()({
			showHover: sinon.stub(),
			hideHover: sinon.stub(),
			setCustomHoverDelay: sinon.stub()
		});

		// Create a comprehensive mock for TableSummaryDataGridInstance
		mockInstance = mockObject<TableSummaryDataGridInstance>()({
			// Essential properties the component needs
			cursorRowIndex: 0,
			focused: false,
			configurationService: mockConfigurationService,
			hoverManager: mockHoverManager,

			// Mock the methods the component calls
			getSupportedFeatures: sinon.stub().returns({
				get_column_profiles: {
					supported_types: [{
						profile_type: ColumnProfileType.SummaryStats,
						support_status: 'supported'
					}]
				}
			}),
			isColumnExpanded: sinon.stub().returns(false),
			toggleExpandColumn: sinon.stub().resolves(),
			getColumnProfileNullPercent: sinon.stub().returns(0),
			getColumnProfileNullCount: sinon.stub().returns(0),
			scrollToRow: sinon.stub(),
			setCursorRow: sinon.stub()
		});
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

	test('displays null percentage correctly based on getColumnProfileNullPercent return value', async () => {
		const columnSchema = getColumnSchema('test_column', 0, 'string', ColumnDisplayType.String);

		// Test case 1: 0% null values
		mockInstance.getColumnProfileNullPercent.returns(0);
		mockInstance.getColumnProfileNullCount.returns(0);

		const component = React.createElement(
			PositronDataGridContextProvider,
			{ instance: mockInstance },
			React.createElement(ColumnSummaryCell, {
				columnIndex: 0,
				columnSchema: columnSchema,
				instance: mockInstance,
				onDoubleClick: () => { }
			})
		);

		// Wait for initial render
		await new Promise<void>((resolve) => {
			root.render(component);
			setTimeout(resolve, 10);
		});

		const nullPercentElement = container.querySelector('.text-percent');
		assert.ok(nullPercentElement, 'Expected to find null percent element');
		assert.strictEqual(nullPercentElement!.textContent, '0%', 'Expected to find 0% for 0% input');
	});

	test('displays 25% when getColumnProfileNullPercent returns 25.7', async () => {
		const columnSchema = getColumnSchema('test_column', 0, 'string', ColumnDisplayType.String);

		// Test case: 25.7% null values should display as 25%
		mockInstance.getColumnProfileNullPercent.returns(25.7);
		mockInstance.getColumnProfileNullCount.returns(257);

		const component = React.createElement(
			PositronDataGridContextProvider,
			{ instance: mockInstance },
			React.createElement(ColumnSummaryCell, {
				columnIndex: 0,
				columnSchema: columnSchema,
				instance: mockInstance,
				onDoubleClick: () => { }
			})
		);

		await new Promise<void>((resolve) => {
			root.render(component);
			setTimeout(resolve, 10);
		});

		const nullPercentElement = container.querySelector('.text-percent');
		assert.ok(nullPercentElement, 'Expected to find null percent element');
		assert.strictEqual(nullPercentElement!.textContent, '25%', 'Expected to find 25% for 25.7% input');
	});

	test('displays <1% when getColumnProfileNullPercent returns 0.5', async () => {
		const columnSchema = getColumnSchema('test_column', 0, 'string', ColumnDisplayType.String);

		// Test case: 0.5% null values should display as <1%
		mockInstance.getColumnProfileNullPercent.returns(0.5);
		mockInstance.getColumnProfileNullCount.returns(5);

		const component = React.createElement(
			PositronDataGridContextProvider,
			{ instance: mockInstance },
			React.createElement(ColumnSummaryCell, {
				columnIndex: 0,
				columnSchema: columnSchema,
				instance: mockInstance,
				onDoubleClick: () => { }
			})
		);

		await new Promise<void>((resolve) => {
			root.render(component);
			setTimeout(resolve, 10);
		});

		const nullPercentElement = container.querySelector('.text-percent');
		assert.ok(nullPercentElement, 'Expected to find null percent element');
		assert.strictEqual(nullPercentElement!.textContent, '<1%', 'Expected to find <1% for 0.5% input');
	});

	test('displays 100% when getColumnProfileNullPercent returns 100', async () => {
		const columnSchema = getColumnSchema('test_column', 0, 'string', ColumnDisplayType.String);

		// Test case: 100% null values
		mockInstance.getColumnProfileNullPercent.returns(100);
		mockInstance.getColumnProfileNullCount.returns(1000);

		const component = React.createElement(
			PositronDataGridContextProvider,
			{ instance: mockInstance },
			React.createElement(ColumnSummaryCell, {
				columnIndex: 0,
				columnSchema: columnSchema,
				instance: mockInstance,
				onDoubleClick: () => { }
			})
		);

		await new Promise<void>((resolve) => {
			root.render(component);
			setTimeout(resolve, 10);
		});

		const nullPercentElement = container.querySelector('.text-percent');
		assert.ok(nullPercentElement, 'Expected to find null percent element');
		assert.strictEqual(nullPercentElement!.textContent, '100%', 'Expected to find 100% for 100% input');
	});
});
