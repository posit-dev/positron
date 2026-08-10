/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename,
	enableDataConnections: true,
});

const connectionName = 'driverLoggingDuckDB';

// The display name each driver registers via `registerDriver`, which is the last statement in
// every driver's `activate()`. Waiting for all seven provider cards to render is therefore proof
// that every driver's activation has fully run (including any illegal logging before that call),
// not just that the extension host has started loading the module.
const allDriverNames = ['DuckDB', 'Databricks', 'PostgreSQL', 'Posit Connect Pins', 'Redshift', 'SQLite', 'Snowflake'];

test.describe('Data connection driver logging', {
	tag: [tags.WEB, tags.WIN, tags.CONNECTIONS, tags.WORKBENCH]
}, () => {

	// Order matters: the first test needs a window where no connection has been made yet, so it
	// must run before the second test creates one. Both tests share the worker-scoped app that
	// `suiteId: __filename` gives this file, and `fullyParallel: false` keeps tests within a file
	// running in declared order, so this ordering is guaranteed as long as no earlier test connects.
	test('creates no output channels until a connection is made', async function ({ app }) {
		// Opening the pane activates all seven driver extensions at once. None of them may log
		// during activation, so none of their channels may exist yet.
		const { dataConnections } = app.workbench;
		await dataConnections.openDataConnectionsView();

		// Extension activation is asynchronous, so reading the channel list right after the pane
		// opens would race it. Opening "Add Connection" and waiting for every provider's card
		// guarantees each driver's activate() has finished (registerDriver is its last call)
		// before the channel list is read below.
		await dataConnections.clickAddConnection();
		for (const name of allDriverNames) {
			await expect(dataConnections.dialog.locator('.driver-card').filter({ hasText: name })).toBeVisible();
		}
		await dataConnections.dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dataConnections.dialog).toBeHidden();

		const channels = await app.workbench.output.getChannelNamesContaining('Data Connections:');
		expect(channels).toEqual([]);
	});

	test('creates the driver channel once a connection is made', async function ({ app }) {
		// The negative assertion above would also pass if the logger were broken and never created
		// a channel at all, so prove the other direction with a local driver that needs no
		// credentials or network access.
		const { dataConnections } = app.workbench;
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

		// Saving only persists the profile; the driver's connect() (where the logger's first call
		// lives) does not run until the connection is actually opened, which happens here.
		await dataConnections.expandConnection(connectionName);

		const channels = await app.workbench.output.getChannelNamesContaining('Data Connections:');
		expect(channels).toContain('Data Connections: DuckDB');
	});
});
