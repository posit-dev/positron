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

				const app = this.app as Application;

				const pythonFixtures = new PositronPythonFixtures(app);
				await pythonFixtures.startPythonInterpreter();

			});

			after(async function () {

				const app = this.app as Application;
				app.workbench.positronConnections.removeConnectionButton.click();

			});


			it('Python - SQLite DB Connection [628636]', async function () {


				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-py', 'sqlite.py'));
				await app.workbench.quickaccess.runCommand('python.execInConsole');

				logger.log('Opening connections pane');
				await app.workbench.positronVariables.doubleClickVariableRow('conn');

				await expect(async () => {
					await app.workbench.positronConnections.openPythonTree();
				}).toPass();

				// click in reverse order to avoid scrolling issues
				await app.workbench.positronConnections.openConnectionsNodes(tables);

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

				const app = this.app as Application;

				const rFixtures = new PositronRFixtures(app);
				await rFixtures.startRInterpreter();

			});

			after(async function () {

				const app = this.app as Application;
				app.workbench.positronConnections.removeConnectionButton.click();

			});


			it('R - SQLite DB Connection [C628637]', async function () {

				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-r', 'sqlite.r'));
				await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

				logger.log('Opening connections pane');
				await app.workbench.positronConnections.connectionsTabLink.click();

				await expect(async () => {
					await app.workbench.positronConnections.openRTree();
				}).toPass();

				// click in reverse order to avoid scrolling issues
				await app.workbench.positronConnections.openConnectionsNodes(tables);

				// disconnect icon appearance requires hover
				await app.workbench.positronConnections.rConnectionOpenState.hover();
				await app.workbench.positronConnections.disconnectButton.click();
				await app.workbench.positronConnections.reconnectButton.waitforVisible();
			});
		});
	});
}
