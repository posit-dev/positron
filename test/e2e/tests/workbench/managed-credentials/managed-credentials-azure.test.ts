/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test, tags } from '../../_test.setup';

test.use({
	suiteId: __filename,
	managedCredentials: 'azure'
});

test.describe('Managed Credentials - Azure', {
	tag: [tags.WORKBENCH_AZURE]
}, () => {
	test('Verify Azure JIT user home directory is provisioned', async function ({ runDockerCommand }) {
		// The Workbench fixture has signed in via Azure OIDC as rstudio-ide-test and launched a
		// Positron Pro session, which triggers PAM session start and home directory creation.
		const result = await runDockerCommand(
			"docker exec test stat -c '%U' /home/rstudio-ide-test",
			'Check rstudio-ide-test home directory exists and is owned by the service account'
		);
		expect(result.stdout.trim()).toBe('rstudio-ide-test');
	});
});
