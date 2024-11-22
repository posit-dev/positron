/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('SQLite DB Connection', { tag: ['@web', '@win', '@pr'] }, () => {
	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['positron.connections.showConnectionPane', 'true']], true);
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.positronConnections.disconnectButton.click();
		await app.workbench.positronConnections.connectionItems.first().click();
		await app.workbench.positronConnections.deleteConnection();
	});

	test('Python - SQLite DB Connection [C628636]', async function ({ app, python }) {
		await test.step('Open a Python file and run it', async () => {
			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-py', 'chinook-sqlite.py'));
			await app.workbench.quickaccess.runCommand('python.execInConsole');
		});

		await test.step('Open connections pane', async () => {
			await app.workbench.positronVariables.clickDatabaseIconForVariableRow('conn');
			await app.workbench.positronConnections.connectIcon.click();
		});

		await test.step('Verify connection nodes', async () => {
			await app.workbench.positronConnections.openConnectionsNodes(['main']);
			await app.workbench.positronConnections.assertConnectionNodes(['albums']);
		});
	});

	test('R - SQLite DB Connection [C628637]', async function ({ app, r }) {
		await test.step('Open an R file and run it', async () => {
			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-r', 'chinook-sqlite.r'));
			await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');
		});

		await test.step('Open connections pane', async () => {
			await app.workbench.positronConnections.openConnectionPane();
			await app.workbench.positronConnections.viewConnection('SQLiteConnection');
		});

		await test.step('Verify connection nodes', async () => {
			await app.workbench.positronConnections.openConnectionsNodes(['SQLiteConnection', 'Default']);
			await app.workbench.positronConnections.openConnectionsNodes(tables);
		});
	});

	test('R - Connections are update after adding a database,[C663724]', async function ({ app, page, r }) {
		await test.step('Open an empty connection', async () => {
			await app.workbench.positronConsole.executeCode(
				'R',
				`con <- connections::connection_open(RSQLite::SQLite(), tempfile())`,
				'>'
			);
		});

		await test.step('Open connections pane', async () => {
			await app.workbench.positronConnections.openConnectionPane();
			await app.workbench.positronConnections.viewConnection('SQLiteConnection');
			await app.workbench.positronConnections.openConnectionsNodes(['SQLiteConnection', 'Default']);

			// mtcars node should not exist
			await expect(
				page.locator('.connections-items-container').getByText('mtcars')
			).not.toBeVisible();
		});


		await test.step('Add a dataframe to the connection', async () => {
			await app.workbench.positronConsole.executeCode(
				'R',
				`DBI::dbWriteTable(con, 'mtcars', mtcars)`,
				'>'
			);

			// refresh and mtcars should exist
			await page.getByRole('button', { name: 'Refresh' }).click();
			await app.workbench.positronConnections.openConnectionsNodes(['mtcars']);
		});
	});

});

// reverse order to avoid scrolling issues
const tables = ['tracks', 'playlist_track', 'playlists', 'media_types', 'invoice_items', 'invoices', 'genres', 'employees', 'customers', 'artists', 'albums'];
