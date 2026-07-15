/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename,
	// The Data Connections panel is a preview feature gated behind `dataConnections.enabled`. This
	// bakes the setting into the app (and the Workbench/Jupyter containers) at startup, since those
	// read settings copied in at launch rather than the host settings file written at runtime.
	enableDataConnections: true,
});

// The password is read from E2E_POSTGRES_PASSWORD (from the project's .env file locally, 1Password in CI).
const connectionName = 'dvdrental';
const host = 'postgres';
const port = '5432';
const database = 'dvdrental';
const user = 'e2e';
const password = process.env.E2E_POSTGRES_PASSWORD || 'testpassword';

// Tables and views in the dvdrental sample database.
const tables = [
	'actor', 'address', 'category', 'city', 'country', 'customer', 'film', 'film_actor',
	'film_category', 'inventory', 'language', 'payment', 'rental', 'staff', 'store',
];
const views = [
	'actor_info', 'customer_list', 'film_list', 'nicer_but_slower_film_list',
	'sales_by_film_category', 'sales_by_store', 'staff_list',
];

// Columns and indexes of the dvdrental `actor` table.
const actorColumns = [
	{ name: 'actor_id', dataType: 'integer' },
	{ name: 'first_name', dataType: 'character varying(45)' },
	{ name: 'last_name', dataType: 'character varying(45)' },
	{ name: 'last_update', dataType: 'timestamp without time zone' },
];
const actorIndexes = ['actor_pkey', 'idx_actor_last_name'];

test.describe('Data Connections - Postgres', {
	tag: [tags.WEB, tags.WIN, tags.CONNECTIONS, tags.WORKBENCH]
}, () => {

	// Configuring the connection is a one-time, stateful action (re-running the new-connection flow
	// would add a duplicate profile), and the app is worker-scoped, so the connection persists across
	// every test in the suite. Create it and expand the tree to a known baseline once here. Per-test
	// state that must not leak between tests (an open Data Explorer tab) is reset in afterEach.
	test.beforeAll(async function ({ app }) {
		// These tests require a running Postgres container, which is only available on the Windows
		// and web CI rigs. The macOS CI project runs @:win-tagged tests too (see playwright.config.ts),
		// but has no Postgres container, so skip the whole suite there.
		test.skip(process.platform === 'darwin', 'No Postgres container available on macOS CI');

		const { dataConnections } = app.workbench;

		await dataConnections.openDataConnectionsView();
		await dataConnections.clickAddConnection();
		await dataConnections.selectProvider('PostgreSQL');
		await dataConnections.selectConnectionMechanism('User & Password');
		await dataConnections.fillConnectionInputs([
			['Connection Name', connectionName],
			['Host', host],
			['Port', port],
			[/^Database/, database],
			[/^User/, user],
			[/^Password/, password],
		]);

		await dataConnections.save();
		await dataConnections.expectConnectionInTree(connectionName);

		await test.step('Expand the tree down to tables and views', async () => {
			await dataConnections.expandConnection(connectionName);
			await dataConnections.expandNode('Schemas');
			await dataConnections.expandNode('public');
			await dataConnections.expandNode('Tables');
			await dataConnections.expandNode('Views');
		});
	});

	// Each preview test opens a Data Explorer tab. Close it so the next test starts from a clean
	// editor state rather than depending on what the previous test left open. The connection and its
	// expanded tree remain in the worker-scoped app.
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

		await test.step('Verify columns and indexes for the actor table', async () => {
			await dataConnections.expandNode('actor');

			await dataConnections.expandNode('Columns');
			for (const { name, dataType } of actorColumns) {
				await dataConnections.expectColumn(name, dataType);
			}

			await dataConnections.expandNode('Indexes');
			for (const index of actorIndexes) {
				await dataConnections.expectNodeVisible(index);
			}
		});
	});

	test('Opens a table in the Data Explorer on double-click', { tag: [tags.DATA_EXPLORER] }, async function ({ app }) {
		const { dataConnections, dataExplorer } = app.workbench;

		await dataConnections.doubleClickNode('actor');

		await dataExplorer.waitForIdle();
		await dataExplorer.grid.expectColumnHeadersToBe(actorColumns.map(({ name }) => name));
	});

	test('Opens a column in the Data Explorer on double-click', { tag: [tags.DATA_EXPLORER] }, async function ({ app }) {
		const { dataConnections, dataExplorer } = app.workbench;

		await dataConnections.expandNode('actor');
		await dataConnections.expandNode('Columns');

		await dataConnections.doubleClickNode('first_name');

		await dataExplorer.waitForIdle();
		await dataExplorer.grid.expectColumnHeadersToBe(['first_name']);
	});
});
