/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// Local setup sample
// docker run --name local-postgres -p 5432:5432 -e POSTGRES_USER=testuser -e POSTGRES_PASSWORD=testpassword -e POSTGRES_DB=testdb -d postgres:latest
// Download https://github.com/neondatabase-labs/postgres-sample-dbs/blob/main/periodic_table.sql
// psql -h localhost -U testuser -d testdb -f /Users/christophermead/Desktop/periodic_table.sql
// psql -h localhost -U testuser -d testdb
// SELECT * FROM periodic_table;
// exit

test.describe('Postgres DB Connection', {
	tag: [tags.WEB, tags.CONNECTIONS]
}, () => {

	test('Python - Can establish a Postgres connection to a docker container', async function ({ app, python }) {

		await app.workbench.connections.openConnectionPane();

		await app.workbench.connections.initiateConnection('Python', 'PostgresSQL');

		await app.workbench.connections.fillConnectionsInputs({
			'Database Name': process.env.E2E_POSTGRES_DB || 'testdb',
			'Host': 'localhost',
			'User': process.env.E2E_POSTGRES_USER || 'testuser',
			'Password': process.env.E2E_POSTGRES_PASSWORD || 'testpassword',
		});

		await app.workbench.connections.connect();

		await test.step('Open periodic table connection', async () => {
			const connectionName = app.code.driver.page.locator('.connections-details', { hasText: 'public' });
			await connectionName.locator('..').locator('.expand-collapse-area .codicon-chevron-right').click();
			await app.code.driver.page.locator('.codicon-positron-table-connection').click();
			await app.workbench.dataExplorer.verifyTab('Data: periodic_table', { isVisible: true });
		});

		await test.step('Verify connection data from periodic table', async () => {
			await app.workbench.sideBar.closeSecondarySideBar();

			await expect(async () => {
				const tableData = await app.workbench.dataExplorer.getDataExplorerTableData();

				expect(tableData[0]['Element']).toBe('Hydrogen');

			}).toPass({ timeout: 60000 });
		});
	});
});

