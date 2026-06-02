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

		// Ensure the db/ directory exists before dbplyr::nycflights13_sqlite() runs.
		fs.mkdirSync(join(app.workspacePathOrFolder, 'db'), { recursive: true });

		await openFile(NYCFLIGHTS_R_SCRIPT);

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


		await connections.openConnectionPane();
		await page.locator('.codicon.codicon-arrow-circle-right').click();
		await expect(page.locator('.connections-item').filter({ hasText: 'SQLiteConnection' })).toBeVisible({ timeout: 30_000 });

		// Expand SQLiteConnection > Default > {airlines, flights, planes} so
		// the columns are visible (matches the 3 expanded tables in the docs ref).
		await connections.openConnectionsNodes(['SQLiteConnection', /^main$|^Default$/, 'airports', /^planes$/]);
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
