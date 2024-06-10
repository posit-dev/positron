/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { join } from 'path';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {

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
				app.code.waitAndClick('a[aria-label="Remove connection from history"]');

			});


			it('Python - SQLite DB Connection', async function () {

				// TestRail 628636

				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'positron-workspaces', 'chinook-db-py', 'sqlite.py'));
				await app.workbench.quickaccess.runCommand('python.execInConsole');

				console.log('Opening connections pane');
				await app.workbench.positronVariables.doubleClickVariableRow('conn');

				await app.code.waitAndClick('div[aria-label="SQLite Connection"]');

				await app.code.waitAndClick('div[aria-label="main"]');

				// click in reverse order to avoid scrolling issues
				await app.code.waitAndClick('div[aria-label="tracks"]');
				await app.code.waitAndClick('div[aria-label="playlist_track"]');
				await app.code.waitAndClick('div[aria-label="playlists"]');
				await app.code.waitAndClick('div[aria-label="media_types"]');
				await app.code.waitAndClick('div[aria-label="invoice_items"]');
				await app.code.waitAndClick('div[aria-label="invoices"]');
				await app.code.waitAndClick('div[aria-label="genres"]');
				await app.code.waitAndClick('div[aria-label="employees"]');
				await app.code.waitAndClick('div[aria-label="customers"]');
				await app.code.waitAndClick('div[aria-label="artists"]');
				await app.code.waitAndClick('div[aria-label="albums"]');

				// disconnect icon appearance requires hover
				await app.code.driver.getLocator('div[aria-label="SQLite Connection"]').hover();
				await app.code.waitAndClick('.codicon-debug-disconnect');
				await app.code.waitForElement('a[aria-label="Execute connection code in the console"]');
			});
		});



		describe('R - SQLite DB', () => {

			before(async function () {

				const app = this.app as Application;

				const rFixtures = new PositronRFixtures(app);
				await rFixtures.startRInterpreter();

			});

			after(async function () {

				const app = this.app as Application;
				app.code.waitAndClick('a[aria-label="Remove connection from history"]');

			});


			it('R - SQLite DB Connection', async function () {

				// TestRail 628637

				const app = this.app as Application;
				await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'positron-workspaces', 'chinook-db-r', 'sqlite.r'));
				await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

				console.log('Opening connections pane');
				await app.code.waitAndClick('a[aria-label="Connections"]');

				// not working due to timing:
				// await app.code.waitAndClick('div[aria-label="SQLiteConnection"]');
				// workaround for above:
				await app.code.driver.getLocator('a:has-text("SQLiteConnection")').click();

				await app.code.waitAndClick('div[aria-label="SQLiteConnection"]:last-child');
				await app.code.waitAndClick('div[aria-label="Default"]');

				// click in reverse order to avoid scrolling issues
				await app.code.waitAndClick('div[aria-label="tracks"]');
				await app.code.waitAndClick('div[aria-label="playlist_track"]');
				await app.code.waitAndClick('div[aria-label="playlists"]');
				await app.code.waitAndClick('div[aria-label="media_types"]');
				await app.code.waitAndClick('div[aria-label="invoice_items"]');
				await app.code.waitAndClick('div[aria-label="invoices"]');
				await app.code.waitAndClick('div[aria-label="genres"]');
				await app.code.waitAndClick('div[aria-label="employees"]');
				await app.code.waitAndClick('div[aria-label="customers"]');
				await app.code.waitAndClick('div[aria-label="artists"]');
				await app.code.waitAndClick('div[aria-label="albums"]');

				// disconnect icon appearance requires hover
				await app.code.driver.getLocator('div[aria-label="SQLiteConnection"]:first-child').hover();
				await app.code.waitAndClick('.codicon-debug-disconnect');
				await app.code.waitForElement('a[aria-label="Execute connection code in the console"]');
			});
		});
	});
}
