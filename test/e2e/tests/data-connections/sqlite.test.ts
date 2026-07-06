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

const connectionName = 'orders';

// Tables in the order_tracking database.
const tables = [
	'categories', 'customers', 'order_items', 'orders',
	'payments', 'products', 'shipments', 'suppliers',
];

// Views in the order_tracking database.
const views = [
	'v_customer_ltv', 'v_order_totals', 'v_pending_fulfillment', 'v_product_sales',
];

// Tables in the order_tracking database used to verify columns and indexes.
// Using a single table avoids ambiguous 'Columns'/'Indexes' locator matches that arise
// when two tables are expanded simultaneously.
const detailTable = 'customers';
const detailColumns = [
	{ name: 'customer_id', dataType: 'INTEGER' },
	{ name: 'first_name', dataType: 'TEXT' },
	{ name: 'last_name', dataType: 'TEXT' },
	{ name: 'email', dataType: 'TEXT' },
	{ name: 'phone', dataType: 'TEXT' },
	{ name: 'city', dataType: 'TEXT' },
	{ name: 'state', dataType: 'TEXT' },
	{ name: 'country', dataType: 'TEXT' },
	{ name: 'created_at', dataType: 'TEXT' },
];
const detailIndexes = ['idx_customers_country'];

test.describe('Data Connections - SQLite', {
	tag: [tags.WEB, tags.WIN, tags.CONNECTIONS, tags.WORKBENCH, tags.DATA_EXPLORER]
}, () => {

	// SQLite connections are file-backed and stateful. Configure once and reuse across the
	// worker-scoped app. afterEach closes any open Data Explorer tab so each test starts clean.
	test.beforeAll(async function ({ app }) {
		const { dataConnections } = app.workbench;

		// The order_tracking.db file lives inside qa-example-content, which is the workspace root.
		const databaseFile = join(app.workspacePathOrFolder, 'data-files/order-tracking/order_tracking.db');

		await dataConnections.openDataConnectionsView();
		await dataConnections.clickAddConnection();
		await dataConnections.selectProvider('SQLite');

		await dataConnections.fillConnectionInputs({
			'Connection Name': connectionName,
			'Database File': databaseFile,
		});

		await dataConnections.save();
		await dataConnections.expectConnectionInTree(connectionName);

		await test.step('Expand the tree down to tables and views', async () => {
			await dataConnections.expandConnection(connectionName);
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
