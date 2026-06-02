/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { join } from 'path';
import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { overrideWorkspaceName, prepareForScreenshot, setScreenshotWindowSize } from './helpers/layout-utils';
import { clearAnnotations } from './helpers/annotate-utils';

const NYCFLIGHTS_R_SCRIPT = join('workspaces', 'nycflights-sqlite-r', 'nycflights-sqlite.r');

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
		const { sessions, console, connections, layouts, quickaccess } = app.workbench;
		await sessions.expectAllSessionsToBeReady();

		// Run the same script that's open in the editor to build and register
		// the connection. This matches the reference screenshot exactly.
		await executeCode('R', [
			'path <- dbplyr::nycflights13_sqlite(path = "db/")',
			'',
			'library(DBI)',
			'con <- dbConnect(',
			'  RSQLite::SQLite(),',
			'  dbname = "db/nycflights13.sqlite",',
			'  bigint = "integer64"',
			')',
			'connections::connection_view(con)',
		].join('\n'), { maximizeConsole: false, timeout: 60000 });

		// Open the checked-in workspace script (same pattern as chinook-sqlite.r).
		// The script uses file.path(getwd(), "db", "nycflights13.sqlite") which
		// resolves to the db/ directory we just created above.
		await openFile(NYCFLIGHTS_R_SCRIPT);

		// Clear the R startup banner so the console shows only the script output.
		await console.clearButton.click();

		// Source the open file — connection_open() registers the connection in
		// Positron's Connections pane.
		await quickaccess.runCommand('r.sourceCurrentFile');

		// Layout: keep the primary sidebar (file explorer) open so the editor
		// is narrower, matching the reference. Only open the connections pane
		// in the aux bar.
		await connections.openConnectionPane();

		// Wait for the schema tree root node to load before expanding children.
		await expect(page.locator('.connections-item').filter({ hasText: 'SQLiteConnection' })).toBeVisible({ timeout: 30_000 });

		// Expand SQLiteConnection > Default > {airlines, flights, planes} so
		// the columns are visible (matches the 3 expanded tables in the docs ref).
		await connections.openConnectionsNodes(['SQLiteConnection', /^main$|^Default$/, 'airlines', /^flights$/, /^planes$/]);
		// Widen the connections pane so the full schema tree and column types
		// are clearly visible, matching the reference.
		await layouts.resizeAuxiliaryBar({ x: -200 });
		// Grow the bottom panel so the console (with script echo) takes a
		// larger portion of the window, matching the ~50/50 editor/console
		// split in the docs reference.
		await layouts.resizePanel({ y: -120 });
		await console.focus();

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'my-project');
		await captureFullWindow(page, 'connections-pane-schema-explorer.png');
	});
});
