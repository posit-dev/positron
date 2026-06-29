/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../../_test.setup';

test.use({
	suiteId: __filename,
	managedCredentials: 'snowflake'
});

test.describe('Managed Credentials - Snowflake', {
	tag: [tags.WORKBENCH_SNOWFLAKE]
}, () => {
	test('R - Verify SNOWFLAKE_ACCOUNT environment variable is set', async function ({ app, r }) {
		await app.workbench.console.executeCode('R', 'Sys.getenv("SNOWFLAKE_ACCOUNT")');
		await app.workbench.console.waitForConsoleContents(process.env.SNOWFLAKE_ACCOUNT!);
	});
});
