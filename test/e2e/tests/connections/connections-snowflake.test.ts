/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

const account = process.env.SNOWFLAKE_ACCOUNT || 'testaccount';
const user = process.env.SNOWFLAKE_USER || 'testuser';
const password = process.env.SNOWFLAKE_PASSWORD || 'testpassword';

test.describe('Snowflake Connection', {
	tag: [tags.WEB, tags.CONNECTIONS]
}, () => {

	test('Python - Can establish a Snowflake connection', async function ({ python, packages, app }) {

		await packages.manage('snowflake', 'install');

		await app.workbench.console.pasteCodeToConsole(connectionCode, true);

		await app.code.driver.page.locator('.codicon-arrow-circle-right').click();

		const essentials = app.code.driver.page.locator('.connections-details', { hasText: 'FINANCIAL__ECONOMIC_ESSENTIALS' });
		await essentials.locator('..').locator('.expand-collapse-area .codicon-chevron-right').click();

		const cyber = app.code.driver.page.locator('.connections-details', { hasText: 'CYBERSYN' });
		await cyber.locator('..').locator('.expand-collapse-area .codicon-chevron-right').click();

		await app.code.driver.page.locator('.codicon-positron-view-connection').first().click();

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
