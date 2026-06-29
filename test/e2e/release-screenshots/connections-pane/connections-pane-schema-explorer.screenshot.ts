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
	await setScreenshotWindowSize(app, { width: 1024, height: 700 });
});

test.afterEach(async ({ app, page, hotKeys }) => {
	await page.keyboard.press('Escape');
	await app.workbench.connections.navigateBack();
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
	test('Release Screenshot - connections-pane-schema-explorer.png', async ({ app, page, openFile, executeCode, settings, r }) => {
		const { sessions, console, connections, layouts, hotKeys } = app.workbench;
		await sessions.expectAllSessionsToBeReady();

		// turn off occurrence highlighting so the editor doesn't box every
		// instance of the word under the cursor (e.g. "path") in the capture.
		await settings.set({ 'editor.occurrencesHighlight': 'off' }, { keepOpen: false });

		// write the script to the workspace root so the file explorer shows a
		// clean single file rather than a nested workspaces/ subdirectory.
		fs.mkdirSync(join(app.workspacePathOrFolder, 'db'), { recursive: true });
		fs.writeFileSync(join(app.workspacePathOrFolder, 'nycflights-sqlite.r'), SCRIPT);
		await openFile('nycflights-sqlite.r');

		// execute the same script to build the DB and register the connection.
		await executeCode('R', SCRIPT, { maximizeConsole: false, timeout: 60000 });
		await connections.openConnectionPane();
		// Wait for the connection to appear in the list, then navigate into it.
		await expect(connections.connectionItems.filter({ hasText: 'SQLiteConnection' })).toBeVisible({ timeout: 30_000 });
		await connections.viewConnection('SQLiteConnection');
		await expect(connections.currentConnectionName).toContainText('SQLiteConnection', { timeout: 30_000 });

		// Expand SQLiteConnection > Default > {airlines, flights, planes} so
		await connections.openConnectionsNodes(['SQLiteConnection', /^main$|^Default$/, 'airports', /^planes$/]);
		await hotKeys.closePrimarySidebar();
		await layouts.resizeAuxiliaryBar({ x: -300 });
		await layouts.resizePanel({ y: -200 });
		await console.focus();

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'my-project');
		await captureFullWindow(page, 'connections-pane-schema-explorer.png');
	});
});
