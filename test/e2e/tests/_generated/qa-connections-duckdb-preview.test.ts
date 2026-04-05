/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from './_qa.setup';

test('Connections: create DuckDB table and preview in Data Explorer', async ({ app }) => {
	const { sessions, console, connections, dataExplorer } = app.workbench;

	await sessions.start('python');

	await connections.openConnectionPane();
	await connections.initiateConnection('Python', 'DuckDB');
	await connections.connect();

	await console.executeCode('Python', [
		'conn.execute("CREATE TABLE users (id INTEGER, name VARCHAR, email VARCHAR)")',
		'conn.execute("INSERT INTO users VALUES (1, \'Alice\', \'alice@example.com\'), (2, \'Bob\', \'bob@test.com\')")',
	].join('\n'));

	await connections.openConnectionsNodes(['main', 'users']);
	await connections.assertConnectionNodes(['id', 'name', 'email']);

	await connections.viewConnection('users');

	await dataExplorer.expectStatusBarToHaveText('2 rows, 3 columns');
	await dataExplorer.grid.expectColumnHeadersToBe(['id', 'name', 'email']);
	await dataExplorer.grid.expectCellContentToBe({ rowIndex: 0, colIndex: 0, value: '1' });
	await dataExplorer.grid.expectCellContentToBe({ rowIndex: 0, colIndex: 1, value: 'Alice' });
	await dataExplorer.grid.expectCellContentToBe({ rowIndex: 0, colIndex: 2, value: 'alice@example.com' });
	await dataExplorer.grid.expectCellContentToBe({ rowIndex: 1, colIndex: 0, value: '2' });
	await dataExplorer.grid.expectCellContentToBe({ rowIndex: 1, colIndex: 1, value: 'Bob' });
	await dataExplorer.grid.expectCellContentToBe({ rowIndex: 1, colIndex: 2, value: 'bob@test.com' });
});
