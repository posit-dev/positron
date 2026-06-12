/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
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

test.describe('Data Connections - Postgres Tree', {
	tag: [tags.WEB, tags.WIN, tags.CONNECTIONS, tags.WORKBENCH]
}, () => {

	test.beforeAll(async function ({ settings }) {
		// The Data Connections panel is gated behind this preview setting and requires a reload.
		await settings.set({ 'dataConnections.enabled': true }, { reload: true });
	});

	test('Can configure a Postgres data connection', async function ({ app }) {
		const { dataConnections } = app.workbench;

		await dataConnections.openDataConnectionsView();
		await dataConnections.clickAddConnection();
		await dataConnections.selectProvider('PostgreSQL');

		await dataConnections.fillConnectionInputs({
			'Connection Name': connectionName,
			'Host': host,
			'Port': port,
			'Database': database,
			'User': user,
			'Password': password,
		});

		await dataConnections.save();

		await dataConnections.expectConnectionInTree(connectionName);

		await test.step('Expand the tree down to tables and views', async () => {
			await dataConnections.expandConnection(connectionName);
			await dataConnections.expandNode('Schemas');
			await dataConnections.expandNode('public');
			await dataConnections.expandNode('Tables');
			await dataConnections.expandNode('Views');
		});

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
});
