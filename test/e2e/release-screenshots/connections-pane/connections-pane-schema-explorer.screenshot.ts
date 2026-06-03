/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import * as fs from 'fs';
import { join } from 'path';
import { test } from '../../tests/_test.setup';
import { captureFullWindow } from '../_helpers/screenshot-utils';
import { overrideWorkspaceName, prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';
import { clearAnnotations } from '../_helpers/annotate-utils';

const SCRIPT = [
	'path <- dbplyr::nycflights13_sqlite(path = "db/")',
	'',
	'library(DBI)',
	'con <- dbConnect(',
	'  RSQLite::SQLite(),',
	'  dbname = "db/nycflights13.sqlite",',
	'  bigint = "integer64"',
	')',
	'connections::connection_view(con)',
].join('\n');

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
		const { sessions, console, connections, layouts } = app.workbench;
		await sessions.expectAllSessionsToBeReady();

		// Write the script to the workspace root so the file explorer shows a
		// clean single file rather than a nested workspaces/ subdirectory.
		fs.mkdirSync(join(app.workspacePathOrFolder, 'db'), { recursive: true });
		fs.writeFileSync(join(app.workspacePathOrFolder, 'nycflights-sqlite.r'), SCRIPT);
		await openFile('nycflights-sqlite.r');

		// Execute the same script to build the DB and register the connection.
		await executeCode('R', SCRIPT, { maximizeConsole: false, timeout: 60000 });


		await connections.openConnectionPane();
		await page.locator('.codicon.codicon-arrow-circle-right').click();
		await expect(page.locator('.connections-item').filter({ hasText: 'SQLiteConnection' })).toBeVisible({ timeout: 30_000 });

		// Expand SQLiteConnection > Default > {airlines, flights, planes} so
		// the columns are visible (matches the 3 expanded tables in the docs ref).
		await connections.openConnectionsNodes(['SQLiteConnection', /^main$|^Default$/, 'airports', /^planes$/]);
		// Widen the connections pane so the full schema tree and column types
		// are clearly visible, matching the reference.
		await layouts.resizeAuxiliaryBar({ x: -300 });
		// Grow the bottom panel so the console (with script echo) takes a
		// larger portion of the window, matching the ~50/50 editor/console
		// split in the docs reference.
		await layouts.resizePanel({ y: -150 });
		await console.focus();

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'my-project');
		await captureFullWindow(page, 'connections-pane-schema-explorer.png');
	});
});
