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

// The sample table: 10 rows, score = (i * 7) % 100, so 'score > 30' keeps rows 5 and up.
const sampleRowCount = 10;

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
	const rows = Array.from({ length: sampleRowCount }, (_, index) => sampleRow(index + 1));
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

// One smoke test for the wiring: the Refresh button shows for a connection table, the click reaches
// the driver through the extension host, and the filter is re-applied to the rebuilt view. The
// rebuild, sort and filter remapping, and failure paths have unit tests.
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

	test.afterAll(async function ({ cleanup }) {
		await cleanup.removeTestFiles([`data-files/${databaseFileName}`]);
	});

	test('Refresh shows a row added outside Positron, with the row filter still applied', async function ({ app, python }) {
		const { dataConnections, dataExplorer } = app.workbench;

		await dataConnections.doubleClickNode('sample');
		await dataExplorer.waitForIdle();
		await dataExplorer.expectStatusBarToHaveText(/10\s+rows\s+10\s+columns/);

		await dataExplorer.filters.add({ columnName: 'score', condition: 'is greater than', value: '30' });
		await dataExplorer.waitForIdle();
		await dataExplorer.expectStatusBarToHaveText(/Showing\s+6\s+rows.*10\s+total/);

		await runSql(app, databaseFile, [`INSERT INTO sample VALUES ${sampleRow(sampleRowCount + 1)}`]);

		await dataExplorer.editorActionBar.clickButton('Refresh');
		await dataExplorer.waitForIdle();
		await dataExplorer.expectStatusBarToHaveText(/Showing\s+7\s+rows.*11\s+total/);
	});
});
