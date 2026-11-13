/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename,
	// These tests cover the older Connections pane, which Data Connections replaces by default.
	enableDataConnections: false,
});

const account = process.env.SNOWFLAKE_ACCOUNT;
const user = process.env.SNOWFLAKE_USER;
const password = process.env.SNOWFLAKE_PASSWORD;

// Holds the password file Python reads, so the password is never typed into the console.
let passwordDir: string | undefined;

test.describe('Snowflake Connection', {
	tag: [tags.WEB, tags.CONNECTIONS]
}, () => {

	test.afterAll(() => {
		if (passwordDir) {
			fs.rmSync(passwordDir, { recursive: true, force: true });
		}
	});

	test('Python - Can establish a Snowflake connection', { tag: [tags.PYTHON] }, async function ({ python, packages, app }) {
		test.skip(!account || !user || !password,
			'Snowflake connection needs SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER and SNOWFLAKE_PASSWORD');

		await packages.manage('snowflake', 'install');

		// The app env has no SNOWFLAKE_* secrets, so the session reads the password from a 0600
		// temp file outside the workspace.
		passwordDir = fs.mkdtempSync(join(os.tmpdir(), 'snowflake-pw-'));
		const passwordPath = join(passwordDir, 'password');
		fs.writeFileSync(passwordPath, `${password}\n`, { mode: 0o600 });

		await app.workbench.console.pasteCodeToConsole(connectionCode(passwordPath), true);

		await app.code.driver.currentPage.locator('.codicon-arrow-circle-right').click({ timeout: 60000 });

		await app.workbench.connections.expandConnectionDetails('FINANCIAL__ECONOMIC_ESSENTIALS');

		await app.workbench.connections.expandConnectionDetails('CYBERSYN');

		await app.code.driver.currentPage.locator('.codicon-positron-view-connection').first().click();

		await app.workbench.dataExplorer.summaryPanel.expectColumnNameToBe(0, 'VARIABLE');

	});
});

// The password never lands in a session variable: the Variables pane would send its
// value over the comm, which the supervisor logs in full at the e2e log level.
const connectionCode = (passwordPath: string) => `import snowflake.connector
def _snowflake_connect(path):
	with open(path) as f:
		return snowflake.connector.connect(
			account='${account}',
			user='${user}',
			password=f.read().strip(),
			warehouse="DEFAULT_WH"
		)
con = _snowflake_connect(${JSON.stringify(passwordPath)})
del _snowflake_connect

%connection_show con`;
