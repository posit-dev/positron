/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import * as fs from 'fs';
import { join } from 'path';
import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { overrideWorkspaceName, prepareForScreenshot, setScreenshotWindowSize } from './helpers/layout-utils';
import { clearAnnotations } from './helpers/annotate-utils';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

test.afterEach(async ({ page, hotKeys }) => {
	await page.keyboard.press('Escape');
	const backButton = page.locator('.positron-connections-schema-navigation .codicon-arrow-left');
	if (await backButton.isVisible()) {
		await backButton.click();
	}
	await clearAnnotations(page);
	await hotKeys.closeAllEditors();
});

test.describe('Release Screenshots - Connections Pane Schema Explorer', () => {
	/**
	 * Img Path: https://positron.posit.co/images/connections-pane-schema-explorer.png
	 *
	 * SQLite connection expanded in the Connections pane, with the schema
	 * tree drilled into a table so the column types are visible.
	 */
	test('Release Screenshot - connections-pane-schema-explorer.png', async ({ app, page, openFile, executeCode, r }) => {
		const { sessions, hotKeys, console, connections, layouts } = app.workbench;
		await sessions.expectAllSessionsToBeReady();

		// Build the nycflights13-schema SQLite database without the nycflights13 R
		// package (not installed in CI's R 4.5.2 env). Create the same 5 tables
		// directly via DBI so the connection pane tree matches the docs reference.
		const scriptName = 'nycflights-sqlite.r';
		const nycflightsDbPath = join(app.workspacePathOrFolder, 'db', 'nycflights13.sqlite').replace(/\\/g, '/');
		const scriptContent = [
			'library(connections)',
			'library(DBI)',
			'library(RSQLite)',
			'',
			'# Create the nycflights13 schema without the nycflights13 package.',
			`db_path <- "${nycflightsDbPath}"`,
			'dir.create(dirname(db_path), recursive = TRUE, showWarnings = FALSE)',
			'tmp <- dbConnect(SQLite(), db_path)',
			'dbExecute(tmp, "CREATE TABLE IF NOT EXISTS airlines (carrier TEXT, name TEXT)")',
			'dbExecute(tmp, "CREATE TABLE IF NOT EXISTS airports (faa TEXT, name TEXT, lat REAL, lon REAL, alt INTEGER, tz INTEGER, dst TEXT, tzone TEXT)")',
			'dbExecute(tmp, "CREATE TABLE IF NOT EXISTS flights (year INTEGER, month INTEGER, day INTEGER, dep_time INTEGER, arr_time INTEGER, carrier TEXT, flight INTEGER, tailnum TEXT, origin TEXT, dest TEXT, air_time REAL, distance REAL)")',
			'dbExecute(tmp, "CREATE TABLE IF NOT EXISTS planes (tailnum TEXT, year INTEGER, type TEXT, manufacturer TEXT, model TEXT, engines INTEGER, seats INTEGER, speed REAL, engine TEXT)")',
			'dbExecute(tmp, "CREATE TABLE IF NOT EXISTS weather (origin TEXT, year INTEGER, month INTEGER, day INTEGER, hour INTEGER, temp REAL, dewp REAL, humid REAL, wind_dir REAL, wind_speed REAL, wind_gust REAL, precip REAL, pressure REAL, visib REAL, time_hour TEXT)")',
			'dbDisconnect(tmp)',
			'',
			'con <- connection_open(SQLite(), db_path)',
			'',
		].join('\n');
		fs.writeFileSync(join(app.workspacePathOrFolder, scriptName), scriptContent);
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

		// connection_open from the R connections package may auto-navigate to schema
		// view even when executed via executeCode (not just r.sourceCurrentFile).
		// In that case, the active connection's arrow icon disappears, so the
		// list-click would time out. Check first; skip the click if already there.
		const inSchemaView = await connections.currentConnectionName
			.filter({ hasText: 'SQLiteConnection' }).isVisible();
		if (!inSchemaView) {
			await page.locator('.connections-list-item').filter({ hasText: 'SQLiteConnection' })
				.locator('.codicon-arrow-circle-right').click({ timeout: 30_000 });
			await expect(connections.currentConnectionName.filter({ hasText: 'SQLiteConnection' })).toBeVisible({ timeout: 15_000 });
		}

		// Wait for the schema tree root node to load before expanding children.
		await expect(page.locator('.connections-item').filter({ hasText: 'SQLiteConnection' })).toBeVisible({ timeout: 30_000 });

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
});
