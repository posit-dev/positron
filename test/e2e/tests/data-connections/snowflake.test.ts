/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { createBrowserLaunchShim } from '../../utils/browserLaunchShim';
import { completeSnowflakeSdkOAuth } from '../../utils/snowflakeOAuth';

// Intercepts the browser launch snowflake-sdk makes during External Browser sign-in. Created at
// module scope because `test.use({ extraEnv })` below is evaluated when this file is collected, so
// the PATH value has to exist by then.
const shim = createBrowserLaunchShim();

test.use({
	suiteId: __filename,
	// The Data Connections panel is a preview feature gated behind `dataConnections.enabled`. This
	// bakes the setting into the app (and the Workbench/Jupyter containers) at startup, since those
	// read settings copied in at launch rather than the host settings file written at runtime.
	enableDataConnections: true,
	// Put the shim ahead of the real browser opener for the launched app. The extension host
	// inherits this, which is where snowflake-sdk runs.
	extraEnv: shim.env,
});

// Snowflake connection details. The account comes from the environment (the project's .env file
// locally, 1Password in CI). The sign-in credentials are the shared IDE service account's, because
// this account federates to Okta -- see snowflakeOAuth.ts.
//
// The env-backed values are read at runtime inside beforeAll, not here: `.env.e2e` is applied by the
// auto `envVars` worker fixture, which runs after this file is evaluated during test collection, so a
// top-level `process.env` read would always be empty (and the suite would skip).
const connectionName = 'snowflake';

// The warehouse queries run on. Not a secret -- it is the CI warehouse's name, fixed for this
// account the way the Redshift suite's port and database are fixed for its cluster.
const warehouse = 'CI_WH';

// Ground truth for the tree assertions. This is a Snowflake Marketplace share rather than anything
// a person created in the account, so its shape is stable; the existing connections-snowflake test
// has been exercising the same database and schema in CI.
const database = 'FINANCIAL__ECONOMIC_ESSENTIALS';
const schema = 'CYBERSYN';

// The share exposes secure views and no tables at all -- its `Tables` node exists but is empty, so
// only `Views` is expanded below. A handful of the 48 views, chosen as the catalog/index ones least
// likely to be reshaped by an upstream data refresh.
const views = [
	'CYBERSYN_DATA_CATALOG',
	'CYBERSYN_DATA_DICTIONARY',
	'COMPANY_INDEX',
];

// The view opened in the Data Explorer, and how wide it is. As with the Databricks suite, the count
// is asserted rather than the column names: the dataset is upstream and this suite's subject is the
// External Browser connection, not grid fidelity.
const previewView = 'BANK_FOR_INTERNATIONAL_SETTLEMENTS_ATTRIBUTES';
const previewViewColumnCount = 10;

// Desktop only, and not Windows. Both limits come from how the browser launch is intercepted, not
// from the sign-in itself, which is the same everywhere:
//
//   - Web and Workbench: the shim reaches the extension host through `extraEnv`, and only the
//     Electron launch path applies that (infra/electron.ts). playwrightBrowser.ts and
//     playwrightExternalServer.ts build the server's env from process.env alone, so the shim never
//     reaches the process running snowflake-sdk -- it would launch a real browser instead.
//   - Windows: the shim cannot work at all. `open` invokes PowerShell by absolute path and never
//     consults PATH, so there is nothing to put ourselves ahead of.
//
// See browserLaunchShim.ts.
test.describe('Data Connections - Snowflake (External Browser)', {
	tag: [tags.CONNECTIONS]
}, () => {

	// Configuring the connection and signing in is a one-time, stateful action, and the app is
	// worker-scoped, so it happens once for the whole suite. Per-test state that must not leak (an
	// open Data Explorer tab) is reset in afterEach.
	test.beforeAll(async function ({ app }) {
		// Read the env-backed connection details now (not at module scope): `.env.e2e` is applied by
		// the auto `envVars` worker fixture, which has run by the time this hook executes.
		const account = process.env.SNOWFLAKE_ACCOUNT || '';
		// The sign-in is Okta's, not Snowflake's: the account federates, so the browser leg uses the
		// shared IDE service account rather than any SNOWFLAKE_USER/SNOWFLAKE_USERNAME value. Guard on
		// what is actually consumed, so a rig with the account but no Okta credentials skips instead
		// of failing halfway through the browser flow.
		const otpSecret = process.env.IDE_SERVICE_ACCOUNT_OTP_SECRET || '';

		// These are secrets. Where they are not provisioned (no .env locally, no 1Password in a given
		// CI rig) the sign-in cannot happen, so skip the whole suite rather than fail. Follows the
		// convention the Redshift tests use.
		test.skip(!account || !otpSecret, 'Snowflake test credentials not configured (SNOWFLAKE_ACCOUNT / IDE_SERVICE_ACCOUNT_OTP_SECRET unset)');

		// The budget covers the interactive sign-in plus a warehouse that may be resuming from idle:
		// the first metadata query restarts a suspended warehouse, which takes appreciably longer than
		// a warm one. Note where that latency lands -- `Databases` is a static container whose twisty
		// flips with no query behind it, so expanding it returns immediately and the wait falls on the
		// *next* expand, the one that lists databases.
		test.setTimeout(900_000);

		const { dataConnections } = app.workbench;
		dataConnections.actionTimeout = 420_000;

		await dataConnections.openDataConnectionsView();
		await dataConnections.clickAddConnection();
		await dataConnections.selectProvider('Snowflake');
		await dataConnections.selectConnectionMechanism('External Browser');
		// User is left unset: for External Browser the identity comes from the browser sign-in, and
		// the field is optional. Account is passed through as-is -- the driver accepts a bare
		// identifier or a full account URL.
		await dataConnections.fillConnectionInputs([
			['Connection Name', connectionName],
			['Account', account],
			[/^Warehouse/, warehouse],
		]);

		// Saving only persists the profile -- no connection is made and no browser opens yet.
		await dataConnections.save();
		await dataConnections.expectConnectionInTree(connectionName);

		// Expanding the entry is what connects, and the driver connects eagerly, so this is where the
		// SDK runs its External Browser flow. The helper starts the expand and drives the browser while
		// it is in flight; the expand call itself resolves as soon as the twisty starts loading, so the
		// step below -- which cannot render until the metadata query returns -- is what proves it
		// connected.
		await completeSnowflakeSdkOAuth(
			shim,
			() => dataConnections.expandConnection(connectionName),
			{ logger: app.code.logger },
		);

		await test.step('Expand the tree down to tables', async () => {
			await dataConnections.expandNode('Databases');
			await dataConnections.expandNode(database, 'database');
			await dataConnections.expandNode('Schemas');
			await dataConnections.expandNode(schema, 'schema');
			await dataConnections.expandNode('Views');
		});

		// The cold-start budget above is only needed for that first chain. Drop back to a normal wait
		// so a genuine failure in the tests below surfaces in seconds rather than minutes.
		dataConnections.actionTimeout = 60_000;
	});

	// Each preview test opens a Data Explorer tab. Close it so the next test starts from a clean
	// editor state rather than depending on what the previous test left open. The connection and its
	// expanded tree remain in the worker-scoped app.
	test.afterEach(async function ({ app }) {
		await app.workbench.hotKeys.closeAllEditors();
	});

	test.afterAll(async function () {
		shim.dispose();
	});

	test('Verify the account databases are listed', async function ({ app }) {
		// The databases in this account are largely people-created and come and go, so assert on the
		// Marketplace share the suite navigates rather than pinning the whole list.
		await app.workbench.dataConnections.expectNodeVisible(database, 'database');
	});

	test('Verify the schemas in the database are listed', async function ({ app }) {
		await app.workbench.dataConnections.expectNodeVisible(schema, 'schema');
		await app.workbench.dataConnections.expectNodeVisible('INFORMATION_SCHEMA', 'schema');
	});

	test('Verify the views in the schema are listed', async function ({ app }) {
		for (const view of views) {
			await app.workbench.dataConnections.expectNodeVisible(view, 'view');
		}
	});

	test('Verify a view opens in the Data Explorer', { tag: [tags.DATA_EXPLORER] }, async function ({ app }) {
		const { dataConnections, dataExplorer } = app.workbench;

		await dataConnections.doubleClickNode(previewView, 'view');

		await dataExplorer.waitForIdle();
		expect(await dataExplorer.grid.getColumnCount()).toBe(previewViewColumnCount);
	});
});
