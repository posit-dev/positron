/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename,
});

// Connections an R or Python session opens show in the Data Connections pane as rows that are
// already connected. A row's text is its name, then the name of the session that opened it, so
// the session name tells which language the connection belongs to.
const rConnectionName = 'SQLiteConnection';
const rEntryText = /SQLiteConnection . R \d/;
const pythonConnectionName = 'SQLite Connection';
const pythonEntryText = /SQLite Connection . Python \d/;

test.describe('Data Connections - Runtime Connections', {
	tag: [tags.WEB, tags.WIN, tags.CONNECTIONS]
}, () => {

	test.afterEach(async function ({ app }) {
		await app.workbench.hotKeys.closeAllEditors();
	});

	test('R connection opened from code appears, browses, previews, and disconnects', {
		tag: [tags.ARK, tags.DATA_EXPLORER]
	}, async function ({ app, r }) {
		const { console, dataConnections, editors } = app.workbench;

		await test.step('Open a connection from R code', async () => {
			// connections::connection_open calls the connection observer, which opens a comm.
			// A plain DBI::dbConnect does not.
			await console.executeCode('R',
				'con <- connections::connection_open(RSQLite::SQLite(), ":memory:"); DBI::dbWriteTable(con, "mtcars", mtcars)');
		});

		await test.step('The pane opens on its own and shows the connection', async () => {
			await dataConnections.expectConnectionInTree(rEntryText);
		});

		await test.step('The R connection is still valid', async () => {
			await console.executeCode('R', 'cat(sprintf("valid-opened=%s\\n", DBI::dbIsValid(con@con)))');
			await console.waitForConsoleContents('valid-opened=TRUE', { exact: true });
		});

		await test.step('Browse to the fields of mtcars', async () => {
			await dataConnections.expandConnection(rConnectionName);
			// The connections package nests tables under a catalog named after the connection, which
			// the pane skips, and then a schema. The schema is 'main' when RSQLite lists it for an
			// empty database (newer RSQLite) and the placeholder 'Default' when it does not.
			await dataConnections.expandNode(/^(main|Default)$/);
			await dataConnections.expandNode('mtcars');
			await dataConnections.expectNodeVisible('mpg');
		});

		await test.step('Collapsing the row keeps the R connection open', async () => {
			await dataConnections.collapseConnection(rConnectionName);
			await console.executeCode('R', 'cat(sprintf("valid-collapsed=%s\\n", DBI::dbIsValid(con@con)))');
			await console.waitForConsoleContents('valid-collapsed=TRUE', { exact: true });
			await dataConnections.expandConnection(rConnectionName);
		});

		await test.step('Double-click mtcars to preview it', async () => {
			await dataConnections.doubleClickNode('mtcars');
			await editors.verifyTab(/mtcars/, { isVisible: true, isSelected: true });
		});

		await test.step('Disconnect closes the R connection and removes the row', async () => {
			await dataConnections.openDataConnectionsView();
			await dataConnections.selectConnectionMenuItem(rConnectionName, 'Disconnect');
			await dataConnections.expectConnectionAbsent(rConnectionName);
			await console.executeCode('R', 'cat(sprintf("valid-disconnected=%s\\n", DBI::dbIsValid(con@con)))');
			await console.waitForConsoleContents('valid-disconnected=FALSE', { exact: true });
		});
	});

	test('Python connection opened from the Variables pane appears and disconnects', {
		tag: [tags.PYTHON]
	}, async function ({ app, python }) {
		const { console, dataConnections, variables } = app.workbench;

		await test.step('Open a sqlite3 connection in Python', async () => {
			await console.executeCode('Python',
				'import sqlite3; con = sqlite3.connect(":memory:"); con.execute("create table mtcars (mpg real)")');
		});

		await test.step('Open the connection from the Variables pane', async () => {
			await variables.focusVariablesView();
			await variables.clickDatabaseIconForVariableRow('con');
		});

		await test.step('The pane opens and shows the connection', async () => {
			await dataConnections.expectConnectionInTree(pythonEntryText);
		});

		await test.step('The Python connection is still usable', async () => {
			await console.executeCode('Python', 'print("select-opened", con.execute("select 1").fetchone())');
			await console.waitForConsoleContents('select-opened (1,)', { exact: true });
		});

		await test.step('Expand the connection to mtcars', async () => {
			await dataConnections.openDataConnectionsView();
			await dataConnections.expandConnection(pythonConnectionName);
			await dataConnections.expandNode('main');
			await dataConnections.expectNodeVisible('mtcars');
		});

		await test.step('Disconnect closes the Python connection and removes the row', async () => {
			await dataConnections.selectConnectionMenuItem(pythonConnectionName, 'Disconnect');
			await dataConnections.expectConnectionAbsent(pythonConnectionName);
			await console.executeCode('Python', 'con.execute("select 1")');
			await console.waitForConsoleContents(/Cannot operate on a closed database/);
		});
	});
});
