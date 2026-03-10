"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
const account = process.env.SNOWFLAKE_ACCOUNT || 'testaccount';
const user = process.env.SNOWFLAKE_USER || 'testuser';
const password = process.env.SNOWFLAKE_PASSWORD || 'testpassword';
_test_setup_1.test.describe('Snowflake Connection', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.CONNECTIONS]
}, () => {
    (0, _test_setup_1.test)('Python - Can establish a Snowflake connection', async function ({ python, packages, app }) {
        await packages.manage('snowflake', 'install');
        await app.workbench.console.pasteCodeToConsole(connectionCode, true);
        await app.code.driver.currentPage.locator('.codicon-arrow-circle-right').click({ timeout: 60000 });
        await app.workbench.connections.expandConnectionDetails('FINANCIAL__ECONOMIC_ESSENTIALS');
        await app.workbench.connections.expandConnectionDetails('CYBERSYN');
        await app.code.driver.currentPage.locator('.codicon-positron-view-connection').first().click();
        await app.workbench.dataExplorer.summaryPanel.expectColumnNameToBe(0, 'VARIABLE');
    });
});
const connectionCode = `import snowflake.connector
con = snowflake.connector.connect(
	account='${account}',
	user='${user}',
	password='${password}',
	warehouse="DEFAULT_WH"
)

%connection_show con`;
//# sourceMappingURL=connections-snowflake.test.js.map