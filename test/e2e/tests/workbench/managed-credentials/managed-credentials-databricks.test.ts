/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../../_test.setup';
import { WorkbenchVersion } from '../../../utils/workbench-version';

test.use({
	suiteId: __filename,
	managedCredentials: 'databricks'
});

test.describe('Managed Credentials - Databricks', {
	tag: [tags.WORKBENCH_DATABRICKS]
}, () => {
	test('R - Verify DATABRICKS_HOST environment variable is set', async function ({ app, r }) {
		const workbenchVersion = await WorkbenchVersion.fetchFromContainer();

		// DATABRICKS_HOST is only available in Workbench 2026.04+
		test.skip(!workbenchVersion.isGreaterThan('2026.04'), 'DATABRICKS_HOST requires Workbench 2026.04+');

		await app.workbench.console.executeCode('R', 'Sys.getenv("DATABRICKS_HOST")');
		const databricksHost = new URL(process.env.DATABRICKS_URL!).host;
		await app.workbench.console.waitForConsoleContents(databricksHost);
	});
});
