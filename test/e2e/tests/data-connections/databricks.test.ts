/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { completeDatabricksDriverOAuth } from '../../utils/databricksOAuth';
import { readPositronServiceAccountCredentials } from '../../utils/oktaSignIn';

test.use({
	suiteId: __filename,
});

// Databricks connection details. The workspace and warehouse come from the environment (the
// project's .env file locally, 1Password in CI); the sign-in itself uses the Positron service
// account (passkey), the same one the Snowflake suites and the assistant's Databricks OAuth test
// use.
//
// The env-backed values are read at runtime inside beforeAll, not here: `.env.e2e` is applied by the
// auto `envVars` worker fixture, which runs after this file is evaluated during test collection, so a
// top-level `process.env` read would always be empty (and the suite would skip).
const connectionName = 'databricks';

// `samples` is the read-only catalog Databricks provisions in every workspace, so its contents are
// stable ground truth in a way `main` or a workspace's own catalogs are not.
const catalog = 'samples';
const schema = 'accuweather';

// The tables in samples.accuweather, in the order the tree renders them.
const accuweatherTables = [
	'forecast_daily_calendar_imperial',
	'forecast_daily_calendar_metric',
	'forecast_daynight_imperial',
	'forecast_daynight_metric',
	'forecast_hourly_imperial',
	'forecast_hourly_metric',
	'historical_daily_calendar_imperial',
	'historical_daily_calendar_metric',
	'historical_daynight_imperial',
	'historical_daynight_metric',
	'historical_hourly_imperial',
	'historical_hourly_metric',
];

// The table opened in the Data Explorer, and how wide it is. The count is asserted rather than
// the 88 column names: the forecast columns belong to Databricks' sample dataset and can change,
// and an 88-entry snapshot would be noise in a suite whose subject is the OAuth connection. The
// Redshift suite covers column-level Data Explorer fidelity in depth.
const accuweatherTable = accuweatherTables[0];
const accuweatherTableColumnCount = 88;

// Desktop only: the authorize URL is captured by patching `shell.openExternal` in the Electron
// main process (see externalUrl.ts), which web and Workbench builds have no equivalent of. The
// Workbench variant, which pastes the redirect back into Positron's prompt, is
// tests/workbench/data-connections/databricks-oauth-u2m.test.ts.
test.describe('Data Connections - Databricks (OAuth U2M)', {
	tag: [tags.CONNECTIONS]
}, () => {

	// Signing in is a one-time, stateful action, so it happens exactly once for the whole suite
	// rather than per test. The app is worker-scoped, so the connection persists across every test
	// here. Per-test state that must not leak (an open Data Explorer tab) is reset in afterEach.
	test.beforeAll(async function ({ app }) {
		// Read the env-backed connection details now (not at module scope): `.env.e2e` is applied by
		// the auto `envVars` worker fixture, which has run by the time this hook executes.
		const host = process.env.DATABRICKS_URL || '';
		const httpPath = process.env.DATABRICKS_HTTP_PATH || '';
		const passkeyCredential = process.env.POSITRON_SERVICE_ACCOUNT_PASSKEY_CREDENTIAL || '';

		// The workspace, the warehouse, and the service account are all secrets. Where they are not
		// provisioned (no .env locally, no 1Password in a given CI rig) the sign-in cannot happen, so
		// skip the whole suite rather than fail. Follows the convention the Redshift tests use.
		test.skip(!host || !httpPath || !passkeyCredential, 'Databricks test credentials not configured (DATABRICKS_URL / DATABRICKS_HTTP_PATH / POSITRON_SERVICE_ACCOUNT_PASSKEY_CREDENTIAL unset)');

		// The budget here covers the interactive sign-in end to end: the Okta SSO hop, the passkey
		// challenge, two Databricks consent screens, and the token exchange.
		//
		// It also has to absorb a cold SQL warehouse. The warehouse auto-stops when idle, and the
		// first metadata query restarts it, which for serverless routinely takes several minutes --
		// long enough that a 240s budget flaked in CI while the same chain took ~70s once warm. Note
		// where that latency lands: `Catalogs` is a static container whose twisty flips with no query
		// behind it, so expanding it returns immediately and the whole cold-start wait falls on the
		// *next* expand, the one that lists catalogs.
		test.setTimeout(900_000);

		const { dataConnections } = app.workbench;
		dataConnections.actionTimeout = 420_000;

		await dataConnections.openDataConnectionsView();
		await dataConnections.clickAddConnection();
		await dataConnections.selectProvider('Databricks');
		await dataConnections.selectConnectionMechanism('OAuth User-to-Machine (U2M)');
		// `host` is passed through as-is, including its scheme: parseDatabricksHost strips the scheme,
		// path, query, and port, and the field's helper text invites pasting a full workspace URL. So
		// this is the value a real user supplies, not a pre-trimmed one.
		await dataConnections.fillConnectionInputs({
			'Connection Name': connectionName,
			'Server Hostname': host,
			'HTTP Path': httpPath,
		});

		// Saving only persists the profile -- no connection is made and no browser opens yet.
		await dataConnections.save();
		await dataConnections.expectConnectionInTree(connectionName);

		// Expanding the entry is what connects, and the driver connects eagerly, so this is where the
		// driver runs OAuth. The expand cannot be awaited until sign-in finishes; the helper starts
		// it, drives the browser, then awaits it.
		await completeDatabricksDriverOAuth(
			app.code,
			() => dataConnections.expandConnection(connectionName),
			{ credentials: readPositronServiceAccountCredentials() },
		);

		await test.step('Expand the tree down to tables', async () => {
			await dataConnections.expandNode('Catalogs');
			await dataConnections.expandNode(catalog, 'database');
			await dataConnections.expandNode('Schemas');
			await dataConnections.expandNode(schema, 'schema');
			await dataConnections.expandNode('Tables');
		});

		// The cold-start budget above is only needed for that first chain. Drop back to a normal
		// wait so a genuine failure in the tests below surfaces in seconds rather than minutes.
		dataConnections.actionTimeout = 60_000;
	});

	// Each preview test opens a Data Explorer tab. Close it so the next test starts from a clean
	// editor state rather than depending on what the previous test left open. The connection and its
	// expanded tree remain in the worker-scoped app.
	test.afterEach(async function ({ app }) {
		await app.workbench.hotKeys.closeAllEditors();
	});

	test('Verify the workspace catalogs are listed', async function ({ app }) {
		// The catalogs a workspace holds are partly up to whoever administers it, so assert on the
		// two Databricks always provisions rather than pinning the whole list.
		await app.workbench.dataConnections.expectNodeVisible(catalog, 'database');
		await app.workbench.dataConnections.expectNodeVisible('hive_metastore', 'database');
	});

	test('Verify the tables in samples.accuweather are listed', async function ({ app }) {
		for (const table of accuweatherTables) {
			await app.workbench.dataConnections.expectNodeVisible(table, 'table');
		}
	});

	test('Verify a table opens in the Data Explorer', { tag: [tags.DATA_EXPLORER] }, async function ({ app }) {
		const { dataConnections, dataExplorer } = app.workbench;

		await dataConnections.doubleClickNode(accuweatherTable, 'table');

		await dataExplorer.waitForIdle();
		expect(await dataExplorer.grid.getColumnCount()).toBe(accuweatherTableColumnCount);
	});
});
