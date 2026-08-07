/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('SQLite DB Connection', {
	tag: [tags.WEB, tags.CRITICAL, tags.CONNECTIONS, tags.WIN]
}, () => {
	test.afterEach(async function ({ app }) {
		await app.workbench.connections.disconnectButton.click();
		await app.workbench.connections.connectionItems.first().click();
		await app.workbench.connections.deleteConnection();
	});

	test('Python - Can establish a SQLite connection, disconnect & reconnect', async function ({ app, python }) {
		await test.step('Open a Python file and run it', async () => {
			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-py', 'chinook-sqlite.py'));
			await app.workbench.quickaccess.runCommand('python.execInConsole');
		});

		await test.step('Open connections pane', async () => {
			await app.workbench.layouts.enterLayout('fullSizedAuxBar');
			// `df` is the script's last statement, so its arrival means execution finished.
			// The database icon sends a `view` RPC over the shell channel, which queues behind
			// the still-running script and never returns if we click too early.
			await app.workbench.variables.waitForVariableRow('df');
			await app.workbench.variables.clickDatabaseIconForVariableRow('conn');
		});

		await test.step('Verify connection nodes', async () => {
			await app.workbench.connections.openConnectionsNodes(['main']);
			await app.workbench.connections.assertConnectionNodes(['albums']);
		});

		await test.step('Disconnect, reconnect with dialog, & reverify', async () => {
			await app.workbench.connections.disconnectButton.click();
			await app.workbench.connections.connectIcon.click();
			await app.workbench.connections.resumeConnectionButton.click();

			await app.workbench.connections.openConnectionsNodes(['main']);
			await app.workbench.connections.assertConnectionNodes(['albums']);
		});
	});

	test('R - Can establish a SQLite connection, disconnect & reconnect', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		await test.step('Open an R file and run it', async () => {
			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-r', 'chinook-sqlite.r'));
			await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');
		});

		await test.step('Open connections pane', async () => {
			await app.workbench.connections.openConnectionPane();
			await app.workbench.connections.viewConnection('SQLiteConnection');
		});

		await test.step('Verify connection nodes', async () => {
			await app.workbench.connections.openConnectionsNodes(['SQLiteConnection', /^main$|^Default$/]);
			await app.workbench.connections.openConnectionsNodes(tables);
		});

		await test.step('Disconnect, reconnect with dialog, & reverify', async () => {
			await app.workbench.connections.disconnectButton.click();
			await app.workbench.connections.connectIcon.click();
			await app.workbench.connections.resumeConnectionButton.click();

			await app.workbench.connections.openConnectionsNodes(['SQLiteConnection', /^main$|^Default$/]);
			await app.workbench.connections.openConnectionsNodes(tables);
		});

	});

	test('R - Ensure SQLite connections are updated after adding a database', {
		tag: [tags.ARK]
	}, async function ({ app, page, r }) {
		await test.step('Open an empty connection', async () => {
			await app.workbench.console.executeCode(
				'R',
				`con <- connections::connection_open(RSQLite::SQLite(), tempfile())`,
			);
		});

		await test.step('Open connections pane', async () => {
			await app.workbench.connections.openConnectionPane();
			await app.workbench.connections.viewConnection('SQLiteConnection');
			await app.workbench.connections.openConnectionsNodes(['SQLiteConnection', /^main$|^Default$/]);

			// mtcars node should not exist
			await expect(
				page.locator('.connections-items-container').getByText('mtcars')
			).not.toBeVisible();
		});


		await test.step('Add a dataframe to the connection', async () => {
			await app.workbench.console.executeCode(
				'R',
				`DBI::dbWriteTable(con, 'mtcars', mtcars)`,
			);

			// refresh and mtcars should exist
			await page.getByRole('button', { name: 'Refresh' }).click();
			await app.workbench.connections.openConnectionsNodes(['mtcars']);
		});
	});

});

// reverse order to avoid scrolling issues
const tables = ['tracks', 'playlist_track', 'playlists', 'media_types', 'invoice_items', 'invoices', 'genres', 'employees', 'customers', 'artists', 'albums'];
