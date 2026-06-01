/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import * as fs from 'fs';
import { join } from 'path';
import { test } from '../tests/_test.setup';
import { captureFullWindow, captureRegion } from './helpers/screenshot-utils';
import { overrideWorkspaceName, prepareForScreenshot, setScreenshotWindowSize } from './helpers/layout-utils';
import { annotate, clearAnnotations } from './helpers/annotate-utils';

const ANNOTATION_COLOR = '#dc2626';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

test.afterEach(async ({ page, hotKeys }) => {
	await page.keyboard.press('Escape');
	// Back out of the connection schema view if a prior test (e.g.,
	// schema-explorer) left us drilled into a connection; the next test
	// assumes the list view and the "New Connection" button is only there.
	const backButton = page.locator('.positron-connections-schema-navigation .codicon-arrow-left');
	if (await backButton.isVisible()) {
		await backButton.click();
	}
	await clearAnnotations(page);
	await hotKeys.closeAllEditors();
});

test.describe('Release Screenshots - Connections Pane', () => {
	/**
	 * Img Path: https://positron.posit.co/images/connections-pane.png
	 *
	 * R session with an active SQLite connection visible in the aux-bar
	 * Connections tab.
	 */
	test('Release Screenshot - connections-pane.png', async ({ app, page, openFile, python }) => {
		const { sessions, hotKeys, variables, connections, layouts, quickaccess } = app.workbench;
		await sessions.expectAllSessionsToBeReady();

		// R connection: source the script. `connections::connection_open()` is
		// the only path that auto-registers a connection in Positron's pane.
		const rScript = join('workspaces', 'chinook-db-r', 'chinook-sqlite.r');
		await openFile(rScript);
		await quickaccess.runCommand('r.sourceCurrentFile');

		// Python connection: run the script (creates `conn` in Variables), then
		// click the database icon to register it in the Connections pane.
		const pyScript = join('workspaces', 'chinook-db-py', 'chinook-sqlite.py');
		await openFile(pyScript);
		await quickaccess.runCommand('python.execInConsole');
		await variables.focusVariablesView();
		// Wait a beat for `conn` to populate; clicking before then no-ops silently.
		await page.waitForTimeout(2000);
		await variables.clickDatabaseIconForVariableRow('conn');

		// Layout: close primary sidebar, focus connections pane, navigate back to
		// the connection-list view (Python's DB-icon click landed us in schema view).
		await hotKeys.closePrimarySidebar();
		await connections.openConnectionPane();
		const backButton = page.locator('.positron-connections-schema-navigation .codicon-arrow-left');
		if (await backButton.isVisible()) {
			await backButton.click();
		}
		await expect(connections.connectionItems).toHaveCount(2, { timeout: 30_000 });
		await layouts.resizeAuxiliaryBar({ x: -100 });

		// Make R the foreground session + R file the active editor to match the
		// docs reference (which features R as the headline language). Use the
		// versioned name so the text query disambiguates against the Python tab
		// (whose name contains "positron", which substring-matches "R").
		await sessions.select(`R ${process.env.POSITRON_R_VER_SEL!}`);
		await openFile(rScript);

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'my-project');
		await captureFullWindow(page, 'connections-pane.png');
	});

	/**
	 * Img Path: https://positron.posit.co/images/connections-pane-schema-explorer.png
	 *
	 * SQLite connection expanded in the Connections pane, with the schema
	 * tree drilled into a table so the column types are visible.
	 */
	test('Release Screenshot - connections-pane-schema-explorer.png', async ({ app, page, openFile, executeCode, r }) => {
		const { sessions, hotKeys, console, connections, layouts } = app.workbench;
		await sessions.expectAllSessionsToBeReady();

		// Write an nycflights13 script to the workspace at runtime to match the
		// docs reference (qa-example-content ships only the chinook fixture).
		// The nycflights13 + dbplyr + connections + RSQLite R packages are
		// preinstalled in CI's R env.
		const scriptName = 'nycflights-sqlite.r';
		const scriptContent = [
			'library(connections)',
			'library(RSQLite)',
			'',
			'dbplyr::nycflights13_sqlite("db")',
			'con <- connection_open(SQLite(), "db/nycflights13.sqlite")',
			'',
		].join('\n');
		fs.writeFileSync(join(app.workspacePathOrFolder, scriptName), scriptContent);
		// dbplyr::nycflights13_sqlite("db") requires the target dir to exist.
		fs.mkdirSync(join(app.workspacePathOrFolder, 'db'), { recursive: true });
		await openFile(scriptName);

		// Clear the R startup banner so the console area shows the script echo
		// (line-by-line `>` prompts), matching the docs reference.
		await console.clearButton.click();

		// source(echo=TRUE) prints each line as it executes -- yields the same
		// `> library(...)` / `> con <- ...` console view shown in the docs.
		// `connections::connection_open()` registers the connection in Positron's pane.
		await executeCode('R', `source("${scriptName}", echo=TRUE)`, { maximizeConsole: false, timeout: 60000 });

		// Layout
		await hotKeys.closePrimarySidebar();
		await connections.openConnectionPane();

		// Run via executeCode doesn't auto-open schema view (only r.sourceCurrentFile
		// does). Drill in from the list view first.
		await connections.viewConnection('SQLiteConnection');

		// Expand SQLiteConnection > Default > {airlines, flights, planes} so
		// the columns are visible (matches the 3 expanded tables in the docs ref).
		await connections.openConnectionsNodes(['SQLiteConnection', /^main$|^Default$/, 'airlines', /^flights$/, /^planes$/]);
		await layouts.resizeAuxiliaryBar({ x: 100 });
		// Grow the bottom panel so the console (with script echo) takes a
		// larger portion of the window, matching the ~50/50 editor/console
		// split in the docs reference.
		await layouts.resizePanel({ y: -120 });

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'my-project');
		await captureFullWindow(page, 'connections-pane-schema-explorer.png');
	});

	/**
	 * Img Path: https://positron.posit.co/images/connections-pane-new-connection.png
	 *
	 * The "New Connection" modal with the PostgreSQL driver selected so the
	 * connection-details form (Database, Host, Port, User, Password) is visible.
	 */
	test('Release Screenshot - connections-pane-new-connection.png', async ({ app, page, r }) => {
		const { sessions, hotKeys, connections } = app.workbench;
		await sessions.expectAllSessionsToBeReady();

		// customize the layout
		await hotKeys.closePrimarySidebar();
		await connections.openConnectionPane();

		// open the new-connection modal with PostgreSQL pre-selected
		await connections.initiateConnection('R', 'PostgreSQL');
		const modal = page.locator('.connections-new-connection-modal, .positron-modal-dialog-box').first();
		await expect(modal).toBeVisible();

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'my-project');
		await captureFullWindow(page, 'connections-pane-new-connection.png');
	});

	/**
	 * Img Path: https://positron.posit.co/images/connections-pane-variables-pane.png
	 *
	 * Cropped capture of the Variables view showing a Python `conn` variable
	 * with the database-icon "open in Connections pane" button highlighted.
	 */
	test('Release Screenshot - connections-pane-variables-pane.png', async ({ app, page, openFile, executeCode, python }) => {
		const { sessions, variables, hotKeys, layouts } = app.workbench;
		await sessions.expectAllSessionsToBeReady();

		const scriptRel = join('workspaces', 'chinook-db-py', 'chinook-sqlite.py');
		await openFile(scriptRel);
		const script = `import sqlite3\nconn = sqlite3.connect("${app.workspacePathOrFolder}/data-files/chinook/chinook.db")`;
		await executeCode('Python', script, { maximizeConsole: false });

		// customize the layout
		await hotKeys.closePrimarySidebar();
		await hotKeys.showSecondarySidebar();
		await variables.focusVariablesView();
		await layouts.resizeAuxiliaryBar({ x: 100 });

		const connRow = page.locator('.variables-instance[style*="z-index: 1"] .variable-item').filter({ hasText: /^conn/ }).first();
		const dbIcon = connRow.locator('.right-column .viewer-icon.codicon-database');
		await expect(dbIcon).toBeVisible();

		// capture screenshot
		await prepareForScreenshot(app, page);
		await annotate(page, [
			{ selector: '.right-column .viewer-icon.codicon-database', label: '', color: ANNOTATION_COLOR, padding: 6, borderWidth: 3 },
		]);

		// Crop tightly to the aux-bar so the shot matches the docs reference
		// (only the SESSION/CONNECTIONS header + Variables view shows).
		const auxBar = page.locator('.part.auxiliarybar');
		const auxBox = await auxBar.boundingBox();
		const connRowBox = await connRow.boundingBox();
		if (!auxBox || !connRowBox) {
			throw new Error('Could not measure aux bar / conn row');
		}
		const bottom = Math.ceil(connRowBox.y + connRowBox.height + 12);
		await captureRegion(page, 'connections-pane-variables-pane.png', {
			x: Math.floor(auxBox.x),
			y: Math.floor(auxBox.y),
			width: Math.ceil(auxBox.width),
			height: bottom - Math.floor(auxBox.y),
		});
	});
});
