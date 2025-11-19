/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

const viewLine = '.lines-content .view-line';
const dbName = process.env.E2E_POSTGRES_DB || 'testdb';
const user = process.env.E2E_POSTGRES_USER || 'testuser';
const password = process.env.E2E_POSTGRES_PASSWORD || 'testpassword';

test.describe('Postgres DB Connection', {
	tag: [tags.WEB, tags.CONNECTIONS, tags.WORKBENCH]
}, () => {

	test('Python - Can establish a Postgres connection to a docker container', async function ({ app, hotKeys, python }) {

		await app.workbench.connections.openConnectionPane();

		await app.workbench.connections.initiateConnection('Python', 'PostgresSQL');

		await app.workbench.connections.fillConnectionsInputs({
			'Database Name': dbName,
			'Host': 'postgres',
			'User': user,
			'Password': password,
		});

		await expect(app.code.driver.page.locator(viewLine, { hasText: '%connection_show conn' })).toBeVisible();
		await expect(app.code.driver.page.locator(viewLine, { hasText: dbName })).toBeVisible();
		await expect(app.code.driver.page.locator(`${viewLine}:has-text("username=\\"${user}\\"")`)).toBeVisible();
		await expect(app.code.driver.page.locator(`${viewLine}:has-text("password=\\"${password}\\"")`)).toBeVisible();

		await app.workbench.connections.connect();

		await test.step('Open periodic table connection', async () => {

			await app.workbench.connections.expandConnectionDetails('public');

			await app.code.driver.page.locator('.codicon-positron-table-connection').first().click();

			// hack to allow for different beahavior based on how db was imported
			try {
				await app.workbench.editors.verifyTab('Data: elements', { isVisible: true });
			} catch {
				await app.workbench.editors.verifyTab('Data: periodic_table', { isVisible: true });
			}
		});

		await test.step('Verify connection data from periodic table', async () => {
			await app.workbench.sideBar.closeSecondarySideBar();

			await expect(async () => {
				const tableData = await app.workbench.dataExplorer.grid.getData();

				// hack to allow for different beahavior based on how db was imported
				try {
					expect(tableData[0]['name']).toBe('Hydrogen');
				} catch {
					expect(tableData[0]['Element']).toBe('Hydrogen');
				}

			}).toPass({ timeout: 60000 });
		});

		await hotKeys.closeAllEditors();
		await app.workbench.layouts.enterLayout('stacked');

		await test.step('Remove connection', async () => {
			await app.workbench.connections.openConnectionPane();

			await app.code.driver.page.getByRole('button', { name: 'Disconnect' }).click();

			await app.code.driver.page.locator('.col-name', { hasText: 'SQLAlchemy (postgresql)' }).click();

			await app.code.driver.page.getByRole('button', { name: 'Delete Connection' }).click();

			await app.code.wait(3000);  // small sleep to ensure everything is truly closed
		});
	});

	test('R - Can establish a Postgres connection to a docker container', {
		tag: [tags.ARK]
	}, async function ({ app, hotKeys, r }) {

		await app.workbench.connections.openConnectionPane();

		await app.workbench.connections.initiateConnection('R', 'PostgresSQL');

		await app.workbench.connections.fillConnectionsInputs({
			'Database Name': dbName,
			'Host': 'postgres',
			'User': user,
			'Password': password,
		});

		await expect(app.code.driver.page.locator(viewLine, { hasText: 'connections::connection_view(con)' })).toBeVisible();
		await expect(app.code.driver.page.locator(viewLine, { hasText: dbName })).toBeVisible();
		await expect(app.code.driver.page.locator(`${viewLine}:has-text("user = \\\'${user}\\\'")`)).toBeVisible();
		await expect(app.code.driver.page.locator(`${viewLine}:has-text("password = \\\'${password}\\\'")`)).toBeVisible();

		await app.workbench.connections.connect();

		await test.step('Open periodic table connection', async () => {

			await app.code.driver.page.locator('.codicon-arrow-circle-right').click();

			await app.workbench.connections.expandConnectionDetails('PqConnection');

			await app.workbench.connections.expandConnectionDetails('public');

			await app.code.driver.page.locator('.codicon-positron-table-connection').first().click();

			// hack to allow for different beahavior based on how db was imported
			try {
				await app.workbench.editors.verifyTab('Data: elements', { isVisible: true });
			} catch {
				await app.workbench.editors.verifyTab('Data: periodic_table', { isVisible: true });
			}
		});

		await test.step('Verify connection data from periodic table', async () => {
			await app.workbench.sideBar.closeSecondarySideBar();

			await expect(async () => {
				const tableData = await app.workbench.dataExplorer.grid.getData();

				// hack to allow for different beahavior based on how db was imported
				try {
					expect(tableData[0]['name']).toBe('Hydrogen');
				} catch {
					expect(tableData[0]['Element']).toBe('Hydrogen');
				}

			}).toPass({ timeout: 60000 });
		});

		await hotKeys.closeAllEditors();

		await test.step('Remove connection', async () => {
			await app.workbench.connections.openConnectionPane();

			await app.code.driver.page.getByRole('button', { name: 'Disconnect' }).click();

			await app.code.driver.page.locator('.col-name', { hasText: 'PqConnection' }).click();

			await app.code.driver.page.getByRole('button', { name: 'Delete Connection' }).click();

			await app.code.wait(3000);  // small sleep to ensure everything is truly closed
		});

	});
});

