/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { Application } from '../../infra';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename,
});

const connectionName = 'refresh-sample';
const databaseFileName = 'data-explorer-refresh.sqlite';

// The sample table: 10 rows, score = (i * 7) % 100, so sorting by id descending puts the newest row
// first and 'score > 30' keeps rows 5 and up.
const columns = ['id', 'name', 'price', 'is_active', 'created_date', 'score', 'category', 'squared', 'root', 'note'];
const columnsWithoutScore = columns.filter(column => column !== 'score');
const idColumn = columns.indexOf('id');
const nameColumn = columns.indexOf('name');

/**
 * Runs SQL statements against the sample database from the Python console. The console is the
 * "outside Positron" writer here: the Data Explorer reads through the SQLite driver, which has
 * its own connection, so these writes are invisible to it until it refreshes.
 */
async function runSql(app: Application, databaseFile: string, statements: string[]): Promise<void> {
	// The console echoes the input, so the marker is assembled by Python rather than typed whole.
	const stamp = Date.now();
	const marker = `sql done ${stamp}`;
	const code = [
		'import sqlite3',
		// Forward slashes keep a Windows path from being mangled by Python string escapes.
		`con = sqlite3.connect('${databaseFile.replace(/\\/g, '/')}')`,
		...statements.map(statement => `con.execute("${statement}")`),
		'con.commit()',
		'con.close()',
		`print('sql done', ${stamp})`,
	].join('\n');
	// Leave the console at its usual size: maximized, it covers the Data Explorer and its toolbar.
	await app.workbench.console.executeCode('Python', code, { maximizeConsole: false });
	await app.workbench.console.waitForConsoleContents(marker);
}

function createSampleTable(): string[] {
	const rows = Array.from({ length: 10 }, (_, index) => sampleRow(index + 1));
	return [
		'DROP TABLE IF EXISTS sample',
		'CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT, price REAL, is_active BOOLEAN, created_date DATE, score INTEGER, category TEXT, squared INTEGER, root REAL, note TEXT)',
		...rows.map(row => `INSERT INTO sample VALUES ${row}`),
	];
}

function sampleRow(i: number): string {
	const day = String(i + 1).padStart(2, '0');
	return `(${i}, 'name_${i}', ${i * 1.5}, ${i % 3 === 0 ? 1 : 0}, '2026-01-${day}', ${(i * 7) % 100}, '${String.fromCharCode(64 + i)}', ${i * i}, ${Math.sqrt(i)}, 'note ${i}')`;
}

test.describe('Data Explorer - Refresh from a Data Connection', {
	tag: [tags.WEB, tags.WIN, tags.CONNECTIONS, tags.DATA_EXPLORER, tags.WORKBENCH]
}, () => {
	let databaseFile: string;

	test.beforeAll(async function ({ app, python }) {
		const { dataConnections } = app.workbench;

		// The database lives in the workspace so the console, the driver, and the cleanup fixture
		// all see the same path, on every lane.
		databaseFile = join(app.workspacePathOrFolder, 'data-files', databaseFileName);
		await runSql(app, databaseFile, createSampleTable());

		await dataConnections.openDataConnectionsView();
		await dataConnections.clickAddConnection();
		await dataConnections.selectProvider('SQLite');
		await dataConnections.fillConnectionInputs({
			'Connection Name': connectionName,
			'Database File': databaseFile,
		});
		await dataConnections.save();
		await dataConnections.expectConnectionInTree(connectionName);
		await dataConnections.expandConnection(connectionName);
		await dataConnections.expandNode('Tables');
	});

	test.beforeEach(async function ({ app, python }) {
		const { dataConnections, dataExplorer } = app.workbench;

		// Each test starts from the same 10 rows, whatever the previous test did to the table.
		await runSql(app, databaseFile, createSampleTable());
		await dataConnections.doubleClickNode('sample');
		await dataExplorer.waitForIdle();
		await dataExplorer.expectStatusBarToHaveText(/10\s+rows\s+10\s+columns/);
	});

	test.afterEach(async function ({ app, hotKeys }) {
		await app.workbench.toasts.closeAll();
		await hotKeys.closeAllEditors();
	});

	test.afterAll(async function ({ cleanup }) {
		await cleanup.removeTestFiles([`data-files/${databaseFileName}`]);
	});

	test('Shows rows added outside Positron and keeps the sort and filter', async function ({ app }) {
		const { dataExplorer } = app.workbench;

		await test.step('Sort by id descending and keep only scores above 30', async () => {
			const columnMenu = await dataExplorer.grid.openColumnContextMenu(idColumn);
			await columnMenu.getByRole('button', { name: 'Sort Descending' }).click();
			await dataExplorer.filters.add({ columnName: 'score', condition: 'is greater than', value: '30' });
			await dataExplorer.waitForIdle();
			await dataExplorer.expectStatusBarToHaveText(/Showing\s+6\s+rows.*10\s+total/);
			await dataExplorer.grid.expectCellContentToBe({ rowIndex: 0, colIndex: nameColumn, value: 'name_10' });
		});

		await test.step('Add a row with the highest score outside Positron', async () => {
			await runSql(app, databaseFile, [`INSERT INTO sample VALUES ${sampleRow(11)}`]);
			// Nothing changes until the user refreshes.
			await dataExplorer.expectStatusBarToHaveText(/Showing\s+6\s+rows.*10\s+total/);
		});

		await test.step('Refresh shows the new row at the top, still sorted and filtered', async () => {
			await dataExplorer.editorActionBar.clickButton('Refresh');
			await dataExplorer.waitForIdle();
			await dataExplorer.expectStatusBarToHaveText(/Showing\s+7\s+rows.*11\s+total/);
			await dataExplorer.grid.expectCellContentToBe({ rowIndex: 0, colIndex: nameColumn, value: 'name_11' });
		});
	});

	test('Keeps a filter on a dropped column as invalid, and keeps the data when the table is gone', async function ({ app }) {
		const { dataExplorer, toasts } = app.workbench;

		await dataExplorer.filters.add({ columnName: 'score', condition: 'is greater than', value: '30' });
		await dataExplorer.waitForIdle();
		await dataExplorer.expectStatusBarToHaveText(/Showing\s+6\s+rows.*10\s+total/);

		await test.step('Drop the filtered column and refresh', async () => {
			await runSql(app, databaseFile, ['ALTER TABLE sample DROP COLUMN score']);
			await dataExplorer.editorActionBar.clickButton('Refresh');
			await dataExplorer.waitForIdle();

			// The filter stays in the bar, marked invalid, and no longer filters anything.
			await dataExplorer.filters.expectInvalidFilterCount(1);
			await dataExplorer.expectStatusBarToHaveText(/Showing\s+10\s+rows.*9\s+columns/);
			await dataExplorer.grid.expectColumnHeadersToBe(columnsWithoutScore);
		});

		await test.step('Drop the table and refresh', async () => {
			await runSql(app, databaseFile, ['DROP TABLE sample']);
			await dataExplorer.editorActionBar.clickButton('Refresh');

			await toasts.waitForAppear(/Unable to refresh the data/);
			await dataExplorer.expectStatusBarToHaveText(/Showing\s+10\s+rows.*9\s+columns/);
			// The header check above scrolled the grid to its last column; focus a visible cell and jump back.
			await dataExplorer.grid.clickCellByIndex(0, columnsWithoutScore.indexOf('note'));
			await dataExplorer.grid.jumpToStart();
			await dataExplorer.grid.expectCellContentToBe({ rowIndex: 0, colIndex: nameColumn, value: 'name_1' });
		});
	});
});
