/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { join } from 'path';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { expect } from '@playwright/test';

/*
 * DB Connections test cases, leveraging the Chinook SQLite database from https://github.com/posit-dev/qa-example-content
 */
export function setup(logger: Logger) {

	const tables = ['tracks', 'playlist_track', 'playlists', 'media_types', 'invoice_items', 'invoices', 'genres', 'employees', 'customers', 'artists', 'albums'];

	describe('Connections Pane', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python - SQLite DB', () => {

			before(async function () {

				await PositronPythonFixtures.SetupFixtures(this.app as Application);

			});

			after(async function () {

				const app = this.app as Application;
				app.workbench.positronConnections.removeConnectionButton.click();

			});


			it('Python - SQLite DB Connection [C628636]', async function () {


				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-py', 'sqlite.py'));
				await app.workbench.quickaccess.runCommand('python.execInConsole');

				logger.log('Opening connections pane');
				await app.workbench.positronVariables.doubleClickVariableRow('conn');
				// in Python this will open all table connections, so should be fine.
				await app.workbench.positronConnections.openTree();

				// click in reverse order to avoid scrolling issues
				await app.workbench.positronConnections.hasConnectionNodes(['albums']);

				// disconnect icon appearance requires hover
				await app.workbench.positronConnections.pythonConnectionOpenState.hover();
				await app.workbench.positronConnections.disconnectButton.click();
				await app.workbench.positronConnections.reconnectButton.waitforVisible();
			});
		});
	});

	describe('Connections Pane', () => {

		// Shared before/after handling
		installAllHandlers(logger);


		describe('R - SQLite DB', () => {

			before(async function () {
				await PositronRFixtures.SetupFixtures(this.app as Application);

			});

			afterEach(async function () {

				const app = this.app as Application;
				app.workbench.positronConnections.removeConnectionButton.click();

			});


			it('R - SQLite DB Connection [C628637]', async function () {

				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-r', 'sqlite.r'));
				await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

				await expect(async () => {
					logger.log('Opening connections pane');
					await app.workbench.positronConnections.openConnectionPane();
					await app.workbench.positronConnections.openTree();

					// click in reverse order to avoid scrolling issues
					// in R, the opneTree command only shows all tables, we click to also
					// display fields
					await app.workbench.positronConnections.openConnectionsNodes(tables);
				}).toPass();

				// disconnect icon appearance requires hover
				await app.workbench.positronConnections.rConnectionOpenState.hover();
				await app.workbench.positronConnections.disconnectButton.click();
				await app.workbench.positronConnections.reconnectButton.waitforVisible();
			});

			it('R - Connections are update after adding a database', async function () {

				const app = this.app as Application;

				// open an empty connection
				await app.workbench.positronConsole.executeCode(
					'R',
					`con <- connections::connection_open(RSQLite::SQLite(), tempfile())`,
					'>'
				);

				// should be able to see the new connection in the connections pane
				logger.log('Opening connections pane');
				await app.workbench.positronConnections.connectionsTabLink.click();

				await app.workbench.positronConnections.openTree();

				const visible = await app.workbench.positronConnections.hasConnectionNode("mtcars");
				if (visible) {
					throw new Error("mtcars should not be visible");
				}

				await expect(async () => {
				// now we add a dataframe to that connection
					await app.workbench.positronConsole.executeCode(
						'R',
						`DBI::dbWriteTable(con, "mtcars", mtcars)`,
						'>'
					);
					// the panel should be automatically updated and we should be able to see
					// that table and click on it
					await app.workbench.positronConnections.openConnectionsNodes(["mtcars"]);
				}).toPass();

			});

		});
	});
}
