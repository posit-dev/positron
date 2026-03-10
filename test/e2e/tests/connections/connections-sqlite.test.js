"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('SQLite DB Connection', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.CRITICAL, _test_setup_1.tags.CONNECTIONS, _test_setup_1.tags.WIN]
}, () => {
    _test_setup_1.test.afterEach(async function ({ app }) {
        await app.workbench.connections.disconnectButton.click();
        await app.workbench.connections.connectionItems.first().click();
        await app.workbench.connections.deleteConnection();
    });
    (0, _test_setup_1.test)('Python - Can establish a SQLite connection, disconnect & reconnect', async function ({ app, python }) {
        await _test_setup_1.test.step('Open a Python file and run it', async () => {
            await app.workbench.quickaccess.openFile((0, path_1.join)(app.workspacePathOrFolder, 'workspaces', 'chinook-db-py', 'chinook-sqlite.py'));
            await app.workbench.quickaccess.runCommand('python.execInConsole');
        });
        await _test_setup_1.test.step('Open connections pane', async () => {
            try {
                await app.workbench.layouts.enterLayout('fullSizedAuxBar');
                // there is a flake of the db connection not displaying in the connections pane after
                // clicking the db icon. To work around, both a wait and a retry are added.
                await app.code.driver.currentPage.waitForTimeout(2000);
                await app.workbench.variables.clickDatabaseIconForVariableRow('conn');
                await app.workbench.connections.connectIcon.click();
            }
            catch (error) {
                // For some reasonm, on the retry, the pane opens directly to this connection
                // and the connectIcon.click() is not needed.
                await app.workbench.sideBar.openSession();
                await app.code.driver.currentPage.waitForTimeout(2000);
                await app.workbench.variables.clickDatabaseIconForVariableRow('conn');
            }
        });
        await _test_setup_1.test.step('Verify connection nodes', async () => {
            await app.workbench.connections.openConnectionsNodes(['main']);
            await app.workbench.connections.assertConnectionNodes(['albums']);
        });
        await _test_setup_1.test.step('Disconnect, reconnect with dialog, & reverify', async () => {
            await app.workbench.connections.disconnectButton.click();
            await app.workbench.connections.connectIcon.click();
            await app.workbench.connections.resumeConnectionButton.click();
            await app.workbench.connections.openConnectionsNodes(['main']);
            await app.workbench.connections.assertConnectionNodes(['albums']);
        });
    });
    (0, _test_setup_1.test)('R - Can establish a SQLite connection, disconnect & reconnect', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, r }) {
        await _test_setup_1.test.step('Open an R file and run it', async () => {
            await app.workbench.quickaccess.openFile((0, path_1.join)(app.workspacePathOrFolder, 'workspaces', 'chinook-db-r', 'chinook-sqlite.r'));
            await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');
        });
        await _test_setup_1.test.step('Open connections pane', async () => {
            await app.workbench.connections.openConnectionPane();
            await app.workbench.connections.viewConnection('SQLiteConnection');
        });
        await _test_setup_1.test.step('Verify connection nodes', async () => {
            await app.workbench.connections.openConnectionsNodes(['SQLiteConnection', 'Default']);
            await app.workbench.connections.openConnectionsNodes(tables);
        });
        await _test_setup_1.test.step('Disconnect, reconnect with dialog, & reverify', async () => {
            await app.workbench.connections.disconnectButton.click();
            await app.workbench.connections.connectIcon.click();
            await app.workbench.connections.resumeConnectionButton.click();
            await app.workbench.connections.openConnectionsNodes(['SQLiteConnection', 'Default']);
            await app.workbench.connections.openConnectionsNodes(tables);
        });
    });
    (0, _test_setup_1.test)('R - Ensure SQLite connections are updated after adding a database', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, page, r }) {
        await _test_setup_1.test.step('Open an empty connection', async () => {
            await app.workbench.console.executeCode('R', `con <- connections::connection_open(RSQLite::SQLite(), tempfile())`);
        });
        await _test_setup_1.test.step('Open connections pane', async () => {
            await app.workbench.connections.openConnectionPane();
            await app.workbench.connections.viewConnection('SQLiteConnection');
            await app.workbench.connections.openConnectionsNodes(['SQLiteConnection', 'Default']);
            // mtcars node should not exist
            await (0, _test_setup_1.expect)(page.locator('.connections-items-container').getByText('mtcars')).not.toBeVisible();
        });
        await _test_setup_1.test.step('Add a dataframe to the connection', async () => {
            await app.workbench.console.executeCode('R', `DBI::dbWriteTable(con, 'mtcars', mtcars)`);
            // refresh and mtcars should exist
            await page.getByRole('button', { name: 'Refresh' }).click();
            await app.workbench.connections.openConnectionsNodes(['mtcars']);
        });
    });
});
// reverse order to avoid scrolling issues
const tables = ['tracks', 'playlist_track', 'playlists', 'media_types', 'invoice_items', 'invoices', 'genres', 'employees', 'customers', 'artists', 'albums'];
//# sourceMappingURL=connections-sqlite.test.js.map