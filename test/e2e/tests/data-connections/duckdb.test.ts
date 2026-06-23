/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename,
	enableDataConnections: true,
});

const connectionName = 'duckdbOrders';

// Tables and views in the order_tracking DuckDB database.
const tables = [
	'categories', 'customers', 'order_items', 'orders',
	'payments', 'products', 'shipments', 'suppliers',
];
const views = [
	'v_customer_ltv', 'v_order_totals', 'v_pending_fulfillment', 'v_product_sales',
];

// Use `customers` for column and index verification — it has both columns and a named index,
// and expanding a single table avoids ambiguous 'Columns'/'Indexes' locator matches.
const detailTable = 'customers';
const detailColumns = [
	{ name: 'customer_id', dataType: 'INTEGER' },
	{ name: 'first_name', dataType: 'VARCHAR' },
	{ name: 'last_name', dataType: 'VARCHAR' },
	{ name: 'email', dataType: 'VARCHAR' },
	{ name: 'phone', dataType: 'VARCHAR' },
	{ name: 'city', dataType: 'VARCHAR' },
	{ name: 'state', dataType: 'VARCHAR' },
	{ name: 'country', dataType: 'VARCHAR' },
	{ name: 'created_at', dataType: 'TIMESTAMP' },
];
const detailIndexes = ['idx_customers_country'];

test.describe('Data Connections - DuckDB', {
	tag: [tags.WEB, tags.WIN, tags.CONNECTIONS, tags.WORKBENCH]
}, () => {

	// Configuring the connection is a one-time, stateful action. The connection and its expanded
	// tree persist across every test in the worker-scoped app. Per-test state (an open Data
	// Explorer tab) is reset in afterEach.
	test.beforeAll(async function ({ app }) {
		const { dataConnections } = app.workbench;

		// The order_tracking.duckdb file lives inside qa-example-content, which is the workspace root.
		const databaseFile = join(app.workspacePathOrFolder, 'data-files/order-tracking/order_tracking.duckdb');

		await dataConnections.openDataConnectionsView();
		await dataConnections.clickAddConnection();
		await dataConnections.selectProvider('DuckDB');

		await dataConnections.fillConnectionInputs({
			'Connection Name': connectionName,
			'Database File': databaseFile,
		});

		await dataConnections.save();
		await dataConnections.expectConnectionInTree(connectionName);

		await test.step('Expand the tree down to tables and views', async () => {
			await dataConnections.expandConnection(connectionName);
			await dataConnections.expandNode('Schemas');
			await dataConnections.expandNode('main');
			await dataConnections.expandNode('Tables');
			await dataConnections.expandNode('Views');
		});
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.hotKeys.closeAllEditors();
	});

	test('Displays tables, views, columns, and indexes in the tree', async function ({ app }) {
		const { dataConnections } = app.workbench;

		await test.step('Verify all tables and views are visible', async () => {
			for (const table of tables) {
				await dataConnections.expectNodeVisible(table);
			}
			for (const view of views) {
				await dataConnections.expectNodeVisible(view);
			}
		});

		await test.step('Verify columns and indexes for the customers table', async () => {
			await dataConnections.expandNode(detailTable);
			await dataConnections.expandNode('Columns');
			for (const { name, dataType } of detailColumns) {
				await dataConnections.expectColumn(name, dataType);
			}
			await dataConnections.expandNode('Indexes');
			for (const index of detailIndexes) {
				await dataConnections.expectNodeVisible(index);
			}
		});
	});

	test('Opens a table in the Data Explorer on double-click', async function ({ app }) {
		const { dataConnections, dataExplorer } = app.workbench;

		await dataConnections.doubleClickNode(detailTable);

		await dataExplorer.waitForIdle();
		await dataExplorer.grid.expectColumnHeadersToBe(detailColumns.map(({ name }) => name));
	});

	test('Opens a column in the Data Explorer on double-click', async function ({ app }) {
		const { dataConnections, dataExplorer } = app.workbench;

		await dataConnections.expandNode(detailTable);
		await dataConnections.expandNode('Columns');

		await dataConnections.doubleClickNode('first_name');

		await dataExplorer.waitForIdle();
		await dataExplorer.grid.expectColumnHeadersToBe(['first_name']);
	});
});
