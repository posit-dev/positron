/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Managed Credentials - Environment Variables', {
	tag: [tags.WORKBENCH]
}, () => {
	test('R - Verify managed credentials environment variables are set', async function ({ app, r }) {

		// Verify SNOWFLAKE_ACCOUNT environment variable
		await app.workbench.console.executeCode('R', 'Sys.getenv("SNOWFLAKE_ACCOUNT")');
		await app.workbench.console.waitForConsoleContents(process.env.SNOWFLAKE_ACCOUNT!);

		// Verify DATABRICKS_HOST environment variable
		await app.workbench.console.executeCode('R', 'Sys.getenv("DATABRICKS_HOST")');
		const databricksHost = new URL(process.env.DATABRICKS_URL!).host;
		await app.workbench.console.waitForConsoleContents(databricksHost);
	});
});
