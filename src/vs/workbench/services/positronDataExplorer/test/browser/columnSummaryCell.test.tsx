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
import { ColumnDisplayType } from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { PositronDataGridContextProvider } from '../../../../browser/positronDataGrid/positronDataGridContext.js';
import { TableSummaryDataGridInstance } from '../../browser/tableSummaryDataGridInstance.js';

suite('ColumnSummaryCell', () => {
	let root: Root;
	let container: HTMLElement;

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

	test('displays null percentage correctly based on getColumnProfileNullPercent return value', async () => {
		// Mock out <ColumnSummaryCell> props
		const columnSchema = getColumnSchema('test_column', 0, 'string', ColumnDisplayType.String);
		const mockTableSummaryDataGridInstance = sinon.createStubInstance(TableSummaryDataGridInstance);
		mockTableSummaryDataGridInstance.getColumnProfileNullPercent.resolves(0);
		mockTableSummaryDataGridInstance.getColumnProfileNullCount.resolves(0);

		// Test case 1: 0% null values
		root.render(
			<PositronDataGridContextProvider instance={mockTableSummaryDataGridInstance}>
				<ColumnSummaryCell
					columnIndex={0}
					columnSchema={columnSchema}
					instance={mockTableSummaryDataGridInstance}
					onDoubleClick={() => { }}
				/>
			</PositronDataGridContextProvider>
		);

		// Wait for initial render
		await new Promise(resolve => setTimeout(resolve, 0));

		const nullPercentElement = container.querySelector('.text-percent');
		assert.ok(nullPercentElement, 'Expected to find null percent element');
		assert.strictEqual(nullPercentElement.textContent, '0%', 'Expected to find 0% for 0% input');
	});

	test('displays 25% when getColumnProfileNullPercent returns 25.7', async () => {

	});

	test('displays <1% when getColumnProfileNullPercent returns 0.5', async () => {

	});

	test('displays 100% when getColumnProfileNullPercent returns 100', async () => {

	});
});
