"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
_test_setup_1.test.use({
    suiteId: __filename
});
const randomText = Math.random().toString(36).substring(7);
function configurePasswordStore() {
    const home = node_os_1.default.homedir(); // likely /root in your container
    // Adjust folder name to your product; for VS Code it's ".vscode"
    const argvDir = node_path_1.default.join(home, '.vscode-oss-dev');
    node_fs_1.default.mkdirSync(argvDir, { recursive: true });
    const argvPath = node_path_1.default.join(argvDir, 'argv.json');
    const argv = {
        // use basic Chromium text encryption – fine for throwaway CI machines
        'password-store': 'basic'
    };
    node_fs_1.default.writeFileSync(argvPath, JSON.stringify(argv, null, 2));
}
_test_setup_1.test.describe('DuckDB Connection', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.CONNECTIONS, _test_setup_1.tags.WIN, _test_setup_1.tags.SOFT_FAIL]
}, () => {
    _test_setup_1.test.beforeAll(async function ({ app }) {
        configurePasswordStore();
    });
    (0, _test_setup_1.test)('Python - Can establish a DuckDB connection', async function ({ python, app }) {
        await app.workbench.console.pasteCodeToConsole(connectionCode, true);
        await app.code.driver.currentPage.locator('.codicon-arrow-circle-right').click({ timeout: 30000 });
        await app.workbench.connections.expandConnectionDetails('db');
        await app.workbench.connections.expandConnectionDetails('main');
        await app.code.driver.currentPage.locator('.codicon-positron-table-connection').first().click();
        await app.workbench.dataExplorer.summaryPanel.expectColumnNameToBe(0, 'item_id');
    });
});
const connectionCode = `import duckdb

con = duckdb.connect(database='db.duckdb.${randomText}')

con.execute("CREATE TABLE items (item_id INTEGER, item_name VARCHAR, price DECIMAL)")
con.execute("INSERT INTO items VALUES (1, 'item1', 10.5), (2, 'item2', 20.0), (3, 'item3', 15.75)")

%connection_show con`;
//# sourceMappingURL=connections-duckdb.test.js.map