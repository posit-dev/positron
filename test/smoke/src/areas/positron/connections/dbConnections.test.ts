/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { join } from 'path';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

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


			it('Python - SQLite DB Connection', async function () {

				// TestRail 628636

				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-py', 'sqlite.py'));
				await app.workbench.quickaccess.runCommand('python.execInConsole');

				console.log('Opening connections pane');
				await app.workbench.positronVariables.doubleClickVariableRow('conn');

				await app.workbench.positronConnections.openPythonTree();

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


			it('R - SQLite DB Connection', async function () {

				// TestRail 628637

				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-r', 'sqlite.r'));
				await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

				console.log('Opening connections pane');
				await app.workbench.positronConnections.connectionsTabLink.click();

				// help with R latency
				await app.code.wait(5000);

				await app.workbench.positronConnections.openRTree();

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
