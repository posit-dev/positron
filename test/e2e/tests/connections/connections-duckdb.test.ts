/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test.use({
	suiteId: __filename,
	// These tests cover the older Connections pane, which Data Connections replaces by default.
	enableDataConnections: false,
});

const randomText = Math.random().toString(36).substring(7);

function configurePasswordStore() {
	const home = os.homedir();            // likely /root in your container
	// Adjust folder name to your product; for VS Code it's ".vscode"
	const argvDir = path.join(home, '.vscode-oss-dev');
	fs.mkdirSync(argvDir, { recursive: true });

	const argvPath = path.join(argvDir, 'argv.json');
	const argv = {
		// use basic Chromium text encryption – fine for throwaway CI machines
		'password-store': 'basic'
	};

	fs.writeFileSync(argvPath, JSON.stringify(argv, null, 2));
}


test.describe('DuckDB Connection', {
	tag: [tags.WEB, tags.CONNECTIONS, tags.WIN]
}, () => {

	test.beforeAll(async function ({ app }) {
		configurePasswordStore();
	});

	test('Python - Can establish a DuckDB connection', async function ({ python, app }) {

		await app.workbench.console.pasteCodeToConsole(connectionCode, true);
		await app.workbench.console.waitForExecutionComplete();

		await app.workbench.connections.openConnectionPane();
		await app.workbench.connections.viewConnection('DuckDB');

		await app.workbench.connections.expandConnectionDetails('db');

		await app.workbench.connections.expandConnectionDetails('main');

		await app.code.driver.currentPage.locator('.codicon-positron-table-connection').first().click();

		await app.workbench.dataExplorer.summaryPanel.expectColumnNameToBe(0, 'item_id');

	});
});

// Keep the database out of the workspace: it is the kernel's cwd, and a teardown delete
// would race the kernel's open file handle (it still holds one, so the delete loses on
// Windows). gettempdir() resolves in the kernel, which is the process that writes the file.
// The filename is unchanged -- the connections pane's 'db' node is derived from it.
const connectionCode = `import duckdb, os, tempfile

con = duckdb.connect(database=os.path.join(tempfile.gettempdir(), 'db.duckdb.${randomText}'))

con.execute("CREATE TABLE items (item_id INTEGER, item_name VARCHAR, price DECIMAL)")
con.execute("INSERT INTO items VALUES (1, 'item1', 10.5), (2, 'item2', 20.0), (3, 'item3', 15.75)")

%connection_show con`;
