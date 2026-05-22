/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../../_test.setup';
import { WorkbenchVersion } from '../../../utils/workbench-version';

test.use({
	suiteId: __filename
});

test.describe('Managed Credentials - Environment Variables', {
	tag: [tags.WORKBENCH]
}, () => {
	test('R - Verify managed credentials environment variables are set', async function ({ app, r }) {
		const workbenchVersion = await WorkbenchVersion.fetchFromContainer();

		// Verify SNOWFLAKE_ACCOUNT environment variable
		await app.workbench.console.executeCode('R', 'Sys.getenv("SNOWFLAKE_ACCOUNT")');
		await app.workbench.console.waitForConsoleContents(process.env.SNOWFLAKE_ACCOUNT!);

		// Verify DATABRICKS_HOST environment variable (only available in 2026.04+)
		if (workbenchVersion.isGreaterThan('2026.04')) {
			await app.workbench.console.executeCode('R', 'Sys.getenv("DATABRICKS_HOST")');
			const databricksHost = new URL(process.env.DATABRICKS_URL!).host;
			await app.workbench.console.waitForConsoleContents(databricksHost);
		}
	});
});
