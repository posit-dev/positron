"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
const viewLine = '.lines-content .view-line';
const dbName = process.env.E2E_POSTGRES_DB || 'testdb';
const user = process.env.E2E_POSTGRES_USER || 'testuser';
const password = process.env.E2E_POSTGRES_PASSWORD || 'testpassword';
_test_setup_1.test.describe('Postgres DB Connection', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.CONNECTIONS, _test_setup_1.tags.WORKBENCH]
}, () => {
    (0, _test_setup_1.test)('Python - Can establish a Postgres connection to a docker container', async function ({ app, hotKeys, python }) {
        await app.workbench.connections.openConnectionPane();
        await app.workbench.connections.initiateConnection('Python', 'PostgreSQL');
        await app.workbench.connections.fillConnectionsInputs({
            'Database Name': dbName,
            'Host': 'postgres',
            'User': user,
            'Password': password,
        });
        await (0, test_1.expect)(app.code.driver.currentPage.locator(viewLine, { hasText: '%connection_show conn' })).toBeVisible();
        await (0, test_1.expect)(app.code.driver.currentPage.locator(viewLine, { hasText: dbName })).toBeVisible();
        await (0, test_1.expect)(app.code.driver.currentPage.locator(`${viewLine}:has-text("username=\\"${user}\\"")`)).toBeVisible();
        await (0, test_1.expect)(app.code.driver.currentPage.locator(`${viewLine}:has-text("password=\\"${password}\\"")`)).toBeVisible();
        await app.workbench.connections.connect();
        await _test_setup_1.test.step('Open periodic table connection', async () => {
            await app.workbench.connections.expandConnectionDetails('public');
            await app.code.driver.currentPage.locator('.codicon-positron-table-connection').first().click();
            // hack to allow for different beahavior based on how db was imported
            try {
                await app.workbench.editors.verifyTab('Data: elements', { isVisible: true });
            }
            catch {
                await app.workbench.editors.verifyTab('Data: periodic_table', { isVisible: true });
            }
        });
        await _test_setup_1.test.step('Verify connection data from periodic table', async () => {
            await app.workbench.sideBar.closeSecondarySideBar();
            await (0, test_1.expect)(async () => {
                const tableData = await app.workbench.dataExplorer.grid.getData();
                // hack to allow for different beahavior based on how db was imported
                try {
                    (0, test_1.expect)(tableData[0]['name']).toBe('Hydrogen');
                }
                catch {
                    (0, test_1.expect)(tableData[0]['Element']).toBe('Hydrogen');
                }
            }).toPass({ timeout: 60000 });
        });
        await hotKeys.closeAllEditors();
        await app.workbench.layouts.enterLayout('stacked');
        await _test_setup_1.test.step('Remove connection', async () => {
            await app.workbench.connections.openConnectionPane();
            await app.code.driver.currentPage.getByRole('button', { name: 'Disconnect' }).click();
            await app.code.driver.currentPage.locator('.col-name', { hasText: 'SQLAlchemy (postgresql)' }).click();
            await app.code.driver.currentPage.getByRole('button', { name: 'Delete Connection' }).click();
            await app.code.wait(3000); // small sleep to ensure everything is truly closed
        });
    });
    (0, _test_setup_1.test)('R - Can establish a Postgres connection to a docker container', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, hotKeys, r }) {
        await app.workbench.connections.openConnectionPane();
        await app.workbench.connections.initiateConnection('R', 'PostgreSQL');
        await app.workbench.connections.fillConnectionsInputs({
            'Database Name': dbName,
            'Host': 'postgres',
            'User': user,
            'Password': password,
        });
        await (0, test_1.expect)(app.code.driver.currentPage.locator(viewLine, { hasText: 'connections::connection_view(con)' })).toBeVisible();
        await (0, test_1.expect)(app.code.driver.currentPage.locator(viewLine, { hasText: dbName })).toBeVisible();
        await (0, test_1.expect)(app.code.driver.currentPage.locator(`${viewLine}:has-text("user = \\\'${user}\\\'")`)).toBeVisible();
        await (0, test_1.expect)(app.code.driver.currentPage.locator(`${viewLine}:has-text("password = \\\'${password}\\\'")`)).toBeVisible();
        await app.workbench.connections.connect();
        await _test_setup_1.test.step('Open periodic table connection', async () => {
            await app.workbench.connections.viewConnection('PqConnection');
            await app.workbench.connections.expandConnectionDetails('PqConnection');
            await app.workbench.connections.expandConnectionDetails('public');
            await app.code.driver.currentPage.locator('.codicon-positron-table-connection').first().click();
            // hack to allow for different beahavior based on how db was imported
            try {
                await app.workbench.editors.verifyTab('Data: elements', { isVisible: true });
            }
            catch {
                await app.workbench.editors.verifyTab('Data: periodic_table', { isVisible: true });
            }
        });
        await _test_setup_1.test.step('Verify connection data from periodic table', async () => {
            await app.workbench.sideBar.closeSecondarySideBar();
            await (0, test_1.expect)(async () => {
                const tableData = await app.workbench.dataExplorer.grid.getData();
                // hack to allow for different beahavior based on how db was imported
                try {
                    (0, test_1.expect)(tableData[0]['name']).toBe('Hydrogen');
                }
                catch {
                    (0, test_1.expect)(tableData[0]['Element']).toBe('Hydrogen');
                }
            }).toPass({ timeout: 60000 });
        });
        await hotKeys.closeAllEditors();
        await _test_setup_1.test.step('Remove connection', async () => {
            await app.workbench.connections.openConnectionPane();
            await app.code.driver.currentPage.getByRole('button', { name: 'Disconnect' }).click();
            await app.code.driver.currentPage.locator('.col-name', { hasText: 'PqConnection' }).click();
            await app.code.driver.currentPage.getByRole('button', { name: 'Delete Connection' }).click();
            await app.code.wait(3000); // small sleep to ensure everything is truly closed
        });
    });
});
//# sourceMappingURL=connections-postgres.test.js.map