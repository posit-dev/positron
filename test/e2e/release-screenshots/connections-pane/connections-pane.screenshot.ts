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

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

test.afterEach(async ({ app, page, hotKeys }) => {
	await page.keyboard.press('Escape');
	await app.workbench.connections.navigateBack();
	await clearAnnotations(page);
	await hotKeys.closeAllEditors();
});

test.describe.skip('Release Screenshots - Connections Pane', () => {
	/**
	 * Img Path: https://positron.posit.co/images/connections-pane.png
	 *
	 * Two DB connections visible in the aux-bar Connections tab:
	 * R SQLite (chinook) and Python SQLAlchemy (sqlite, chinook).
	 */
	test('Release Screenshot - connections-pane.png', async ({ app, page, openFile }) => {
		const { sessions, hotKeys, variables, connections, layouts, quickaccess } = app.workbench;
		const [rSession, pythonSession] = await sessions.start(['r', 'python']);

		// 1. R SQLite (chinook): source so connection_open() registers SQLiteConnection.
		const rScript = join('workspaces', 'chinook-db-r', 'chinook-sqlite.r');
		await openFile(rScript);
		await quickaccess.runCommand('r.sourceCurrentFile');

		// 2. Python SQLAlchemy (sqlite backend): Positron recognizes sqlalchemy.engine.base.Engine
		const chinookDbPath = join(app.workspacePathOrFolder, 'data-files', 'chinook', 'chinook.db').replace(/\\/g, '/');
		const pyScriptName = 'sqlalchemy-conn.py';
		fs.writeFileSync(join(app.workspacePathOrFolder, pyScriptName), [
			'from sqlalchemy import create_engine',
			`conn = create_engine('sqlite:///${chinookDbPath}')`,
		].join('\n'));
		await openFile(pyScriptName);
		await quickaccess.runCommand('python.execInConsole');

		// open the connection pane and view the Python connection to ensure both connections are visible in the aux bar
		await sessions.select(pythonSession.id);
		await variables.focusVariablesView();
		const pyConnRow = variables.variableRow('conn');
		await expect(pyConnRow.locator('.right-column .viewer-icon.codicon-database')).toBeVisible({ timeout: 20_000 });
		await variables.clickDatabaseIconForVariableRow('conn');

		// customize layout
		await hotKeys.closePrimarySidebar();
		await connections.openConnectionPane();
		const backButton = page.locator('.positron-connections-schema-navigation .codicon-arrow-left');
		if (await backButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
			await backButton.click();
		}
		await expect(connections.connectionItems).toHaveCount(2, { timeout: 30_000 });
		await layouts.resizeAuxiliaryBar({ x: -250 });

		// make R the foreground session + R file the active editor.
		await sessions.select(rSession.id);
		await openFile(rScript);

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'test-files', 'my-project');
		await captureFullWindow(page, 'connections-pane.png');
	});
});
