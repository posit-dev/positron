/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../../_test.setup';

test.use({
	suiteId: __filename,
	managedCredentials: 'snowflake'
});

// A Snowflake Marketplace share in the CI account, the same ground truth the External Browser
// suites assert on. The Workbench credential is authorized by the same Okta service account.
const database = 'FINANCIAL__ECONOMIC_ESSENTIALS';

test.describe('Managed Credentials - Snowflake', {
	tag: [tags.WORKBENCH_SNOWFLAKE]
}, () => {
	test('R - Verify SNOWFLAKE_ACCOUNT environment variable is set', { tag: [tags.ARK] }, async function ({ app, r }) {
		await app.workbench.console.executeCode('R', 'Sys.getenv("SNOWFLAKE_ACCOUNT")');
		await app.workbench.console.waitForConsoleContents(process.env.SNOWFLAKE_ACCOUNT!);
	});

	// Both Data Connections tests connect with the OAuth token Workbench writes to its managed
	// connections.toml: one through the mechanism that reads the credential directly, one through
	// the connections-file mechanism that parses the same entry. Each expands its own connection down
	// to the databases, which is where the token is first presented to Snowflake.
	test.describe('Data Connections', { tag: [tags.CONNECTIONS] }, () => {
		// The connection the current test added, collapsed after the test (even a failed one) so the
		// next test's 'Databases' lookup does not also match this connection's subtree.
		let addedConnection: string | undefined;

		test.beforeEach(async function ({ app }) {
			// Expanding the entry connects, and a Snowflake connect over OAuth can take a while.
			test.setTimeout(300_000);
			app.workbench.dataConnections.actionTimeout = 120_000;
			addedConnection = undefined;
			await app.workbench.dataConnections.openDataConnectionsView();
		});

		test.afterEach(async function ({ app }) {
			const { dataConnections } = app.workbench;
			try {
				if (addedConnection) {
					await dataConnections.collapseConnection(addedConnection);
				}
			} finally {
				// The page object is shared by later suites in this worker.
				dataConnections.actionTimeout = undefined;
			}
		});

		test('Workbench Managed Credentials connection lists the account databases', async function ({ app }) {
			const { dataConnections } = app.workbench;
			const connectionName = 'snowflake-workbench';

			await dataConnections.clickAddConnection();
			await dataConnections.selectProvider('Snowflake');
			await dataConnections.selectConnectionMechanism('Workbench Managed Credentials');
			await dataConnections.fillConnectionInputs({ 'Connection Name': connectionName });
			await dataConnections.save();
			await dataConnections.expectConnectionInTree(connectionName);
			addedConnection = connectionName;

			await dataConnections.expandConnection(connectionName);
			await dataConnections.expandNode('Databases');
			await dataConnections.expectNodeVisible(database, 'database');
		});

		test('Connections File connection lists the account databases', async function ({ app }) {
			const { dataConnections } = app.workbench;
			const connectionName = 'snowflake-connections-file';

			await dataConnections.clickAddConnection();
			await dataConnections.selectProvider('Snowflake');
			await dataConnections.selectConnectionMechanism('Connections File');
			await dataConnections.fillConnectionInputs({ 'Connection Name': connectionName });
			// The entry Workbench provisions in the managed connections.toml.
			await dataConnections.selectConnectionOption('Connection', 'workbench');
			await dataConnections.save();
			await dataConnections.expectConnectionInTree(connectionName);
			addedConnection = connectionName;

			await dataConnections.expandConnection(connectionName);
			await dataConnections.expandNode('Databases');
			await dataConnections.expectNodeVisible(database, 'database');
		});
	});
});
