/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect } from '../_test.setup';
import { UserSetting } from '../../../../../automation';

const connectionSetting: UserSetting = ['positron.connections.showConnectionPane', 'true'];

test.use({
	suiteId: __filename,
});

test.describe('SQLite DB Connection', { tag: ['@web', '@win'] }, () => {
	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([connectionSetting], true);
	});

	test.afterEach(async function ({ app, page }) {
		// await app.workbench.positronConnections.removeConnectionButton.click();
		await page.getByLabel('Delete Connection').click();
	});

	test('Python - SQLite DB Connection [C628636]', async function ({ app, page, logger, python }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-py', 'chinook-sqlite.py'));
		await app.workbench.quickaccess.runCommand('python.execInConsole');

		await page.locator('div:nth-child(4) > .details-column > .right-column > .viewer-icon').click();
		await page.locator('.connections-list-item > .col-icon').click();
		await page.locator('.col-action > .codicon').click(); // arrow on right
		await page.locator('.expand-collapse-area > .codicon').click(); // caret on left

		// click in reverse order to avoid scrolling issues
		await app.workbench.positronConnections.assertConnectionNodes(['albums']);

		// disconnect
		await app.workbench.positronConnections.disconnectButton.click();
		await page.getByText('SQLite Connection').click();
		await expect(page.getByLabel('Delete Connection')).toBeVisible();
	});


	test('R - SQLite DB Connection [C628637]', async function ({ app, page, logger, r }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-r', 'chinook-sqlite.r'));
		await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

		// open connections pane
		await app.workbench.positronConnections.openConnectionPane();
		await page.locator('.col-action > .codicon').click(); // arrow on right
		await page.locator('.expand-collapse-area > .codicon').click(); // caret on left

		// click in reverse order to avoid scrolling issues
		await app.workbench.positronConnections.openConnectionsNodes(['Default']);
		await app.workbench.positronConnections.openConnectionsNodes(tables);

		// disconnect icon appearance requires hover
		// await app.workbench.positronConnections.rConnectionOpenState.hover();
		// await app.workbench.positronConnections.disconnectButton.click();
		// await app.workbench.positronConnections.reconnectButton.waitforVisible();
		await app.workbench.positronConnections.disconnectButton.click();
		await page.getByText('SQLiteConnection').click();
		await expect(page.getByLabel('Delete Connection')).toBeVisible();
	});

	test('R - Connections are update after adding a database,[C663724]', async function ({ app, page, logger, r }) {
		// open an empty connection
		await app.workbench.positronConsole.executeCode(
			'R',
			`con <- connections::connection_open(RSQLite::SQLite(), tempfile())`,
			'>'
		);

		// // should be able to see the new connection in the connections pane
		// logger.log('Opening connections pane');
		// await app.workbench.positronConnections.connectionsTabLink.click();

		// await app.workbench.positronConnections.openTree();
		// open connections pane
		await app.workbench.positronConnections.openConnectionPane();
		await page.locator('.col-action > .codicon').click(); // arrow on right
		await page.locator('.expand-collapse-area > .codicon').click(); // caret on left



		// mtcars node should not exist
		await app.workbench.positronConnections.openConnectionsNodes(['Default']);
		await expect(
			page.locator('.connections-items-container').getByText('mtcars')
		).not.toBeVisible();

		// now we add a dataframe to that connection
		await app.workbench.positronConsole.executeCode(
			'R',
			`DBI::dbWriteTable(con, "mtcars", mtcars)`,
			'>'
		);

		await page.getByRole('button', { name: 'Refresh' }).click();
		await app.workbench.positronConnections.openConnectionsNodes(["mtcars"]);

		await app.workbench.positronConnections.disconnectButton.click();
		await page.getByText('SQLiteConnection').click();
		await expect(page.getByLabel('Delete Connection')).toBeVisible();
		// disconnect icon appearance requires hover
		// await app.workbench.positronConnections.rConnectionOpenState.hover();
		// await app.workbench.positronConnections.disconnectButton.click();
		// await app.workbench.positronConnections.reconnectButton.waitforVisible();
	});

});


const tables = ['tracks', 'playlist_track', 'playlists', 'media_types', 'invoice_items', 'invoices', 'genres', 'employees', 'customers', 'artists', 'albums'];
