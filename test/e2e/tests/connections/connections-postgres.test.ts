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

		await app.code.driver.page.getByRole('button', { name: 'New Connection' }).click();

		await app.code.driver.page.locator('.connections-new-connection-modal .codicon-chevron-down').click();

		await app.code.driver.page.locator('.positron-modal-popup-children').getByRole('button', { name: 'Python' }).click();

		await app.code.driver.page.locator('.driver-name', { hasText: 'PostgresSQL' }).click();

		const dbNameLabel = app.code.driver.page.locator('span.label-text', { hasText: 'Database Name' });
		const dbNameInput = dbNameLabel.locator('+ input.text-input');
		await dbNameInput.fill(process.env.E2E_POSTGRES_DB || 'testdb');

		const hostLabel = app.code.driver.page.locator('span.label-text', { hasText: 'Host' });
		const hostInput = hostLabel.locator('+ input.text-input');
		await hostInput.fill('localhost');

		const userLabel = app.code.driver.page.locator('span.label-text', { hasText: 'User' });
		const userInput = userLabel.locator('+ input.text-input');
		await userInput.fill(process.env.E2E_POSTGRES_USER || 'testuser');

		const passwordLabel = app.code.driver.page.locator('span.label-text', { hasText: 'Password' });
		const passwordInput = passwordLabel.locator('+ input.text-input');
		await passwordInput.fill(process.env.E2E_POSTGRES_PASSWORD || 'testpassword');

		await expect(app.code.driver.page.locator('.lines-content .view-line', { hasText: '%connection_show conn' })).toBeVisible();

		await app.code.driver.page.locator('.button', { hasText: 'Connect' }).click();

		const connectionName = app.code.driver.page.locator('.connections-details', { hasText: 'public' });
		await connectionName.locator('..').locator('.expand-collapse-area .codicon-chevron-right').click();

		await app.code.driver.page.locator('.codicon-positron-table-connection').click();

		await app.workbench.dataExplorer.verifyTab('Data: periodic_table', { isVisible: true });

		await app.workbench.sideBar.closeSecondarySideBar();

		await expect(async () => {
			const tableData = await app.workbench.dataExplorer.getDataExplorerTableData();

			expect(tableData[0]['Element']).toBe('Hydrogen');

		}).toPass({ timeout: 60000 });

	});

});

