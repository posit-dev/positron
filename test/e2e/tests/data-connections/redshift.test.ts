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

// Redshift connection details. Host/user/password come from the environment (the project's .env
// file locally, 1Password in CI); port and database are fixed for the test cluster. The endpoint is
// a private serverless Redshift workgroup reachable only over Tailscale, so both local runs and CI
// need network access to it -- see redshift.test.ts docs / the CI workflow's Tailscale step.
//
// The env-backed values are read at runtime inside beforeAll, not here: `.env.e2e` is applied by the
// auto `envVars` worker fixture, which runs after this file is evaluated during test collection, so a
// top-level `process.env` read would always be empty (and the suite would skip).
const connectionName = 'redshift';
const port = '5439';
const database = 'dev';

// The test cluster has a `flights` database (alongside the connection's own `dev` database) holding a
// single `public.flights` table -- the nycflights13 dataset loaded into Redshift. Note the database
// and the table share the name `flights`, so tree lookups for the table pass an explicit node kind
// to disambiguate them (see DataConnections.expandNode / doubleClickNode).
const detailDatabase = 'flights';
const detailTable = 'flights';

// Columns of the flights table, in the order the tree renders them, with their Redshift data types.
const flightsColumns = [
	{ name: 'year', dataType: 'smallint' },
	{ name: 'month', dataType: 'smallint' },
	{ name: 'day', dataType: 'smallint' },
	{ name: 'dep_time', dataType: 'smallint' },
	{ name: 'sched_dep_time', dataType: 'smallint' },
	{ name: 'dep_delay', dataType: 'smallint' },
	{ name: 'arr_time', dataType: 'smallint' },
	{ name: 'sched_arr_time', dataType: 'smallint' },
	{ name: 'arr_delay', dataType: 'smallint' },
	{ name: 'carrier', dataType: 'character varying(256)' },
	{ name: 'flight', dataType: 'smallint' },
	{ name: 'tailnum', dataType: 'character varying(256)' },
	{ name: 'origin', dataType: 'character varying(256)' },
	{ name: 'dest', dataType: 'character varying(256)' },
	{ name: 'air_time', dataType: 'smallint' },
	{ name: 'distance', dataType: 'smallint' },
	{ name: 'hour', dataType: 'smallint' },
	{ name: 'minute', dataType: 'smallint' },
	{ name: 'time_hour', dataType: 'timestamp without time zone' },
];

test.describe('Data Connections - Redshift', {
	tag: [tags.WEB, tags.WIN, tags.CONNECTIONS, tags.WORKBENCH]
}, () => {

	// Configuring the connection is a one-time, stateful action (re-running the new-connection flow
	// would add a duplicate profile), and the app is worker-scoped, so the connection persists across
	// every test in the suite. Create it and expand the tree to a known baseline once here. Per-test
	// state that must not leak between tests (an open Data Explorer tab) is reset in afterEach.
	test.beforeAll(async function ({ app }) {
		// Read the env-backed connection details now (not at module scope): `.env.e2e` is applied by
		// the auto `envVars` worker fixture, which has run by the time this hook executes.
		const host = process.env.REDSHIFT_TEST_HOST || '';
		const user = process.env.REDSHIFT_TEST_USERNAME || '';
		const password = process.env.REDSHIFT_TEST_PASSWORD || '';

		// The test workgroup is a private serverless Redshift reached over Tailscale, and its host /
		// credentials are secrets. Where those aren't provisioned (no .env locally, no secrets +
		// Tailscale in a given CI rig) the connection can't be made, so skip the whole suite rather
		// than fail. Runs anywhere REDSHIFT_TEST_HOST is set.
		test.skip(!host, 'Redshift test credentials not configured (REDSHIFT_TEST_HOST unset)');

		// A serverless workgroup can cold-start on first connect and its metadata queries are slow, so
		// give this hook and every DataConnections wait a generous budget.
		test.setTimeout(180_000);

		const { dataConnections } = app.workbench;
		dataConnections.actionTimeout = 60_000;

		await dataConnections.openDataConnectionsView();
		await dataConnections.clickAddConnection();
		await dataConnections.selectProvider('Redshift');
		// Redshift exposes a single connection mechanism (User & Password), so the flow advances
		// straight to the configure step without a mechanism-selection dialog. SSL is left on (the
		// default), which the serverless endpoint requires.
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
			await dataConnections.expandNode('Databases');
			await dataConnections.expandNode(detailDatabase, 'database');
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

	test('Displays the table, columns, and their types in the tree', async function ({ app }) {
		const { dataConnections } = app.workbench;

		await test.step('Verify the flights table is visible', async () => {
			await dataConnections.expectNodeVisible(detailTable, 'table');
		});

		await test.step('Verify columns and types for the flights table', async () => {
			await dataConnections.expandNode(detailTable, 'table');
			await dataConnections.expandNode('Columns');
			for (const { name, dataType } of flightsColumns) {
				await dataConnections.expectColumn(name, dataType);
			}
		});
	});

	test('Opens a table in the Data Explorer on double-click', { tag: [tags.DATA_EXPLORER] }, async function ({ app }) {
		const { dataConnections, dataExplorer } = app.workbench;

		await dataConnections.doubleClickNode(detailTable, 'table');

		await dataExplorer.waitForIdle();
		await dataExplorer.grid.expectColumnHeadersToBe(flightsColumns.map(({ name }) => name));
	});

	test('Opens a column in the Data Explorer on double-click', { tag: [tags.DATA_EXPLORER] }, async function ({ app }) {
		const { dataConnections, dataExplorer } = app.workbench;

		await dataConnections.expandNode(detailTable, 'table');
		await dataConnections.expandNode('Columns');

		await dataConnections.doubleClickNode('year');

		await dataExplorer.waitForIdle();
		await dataExplorer.grid.expectColumnHeadersToBe(['year']);
	});
});
