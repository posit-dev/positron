/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as base, tags } from '../_test.setup';

const test = base.extend<{}, {}>({
	beforeApp: [
		async ({ settingsFile }, use) => {
			await settingsFile.append({
				'python.useBundledIpykernel': false,
			});
			await use();
		},
		{ scope: 'worker' }
	],
});

test.use({
	suiteId: __filename
});

test.describe('Console Pane: Alternate Python', { tag: [tags.WEB, tags.CONSOLE, tags.WIN, tags.PYTHON] }, () => {

	test('Verify alternate python can skip bundled ipykernel', async ({ app, sessions }) => {
		await sessions.start('pythonAlt');
		await sessions.clearConsoleAllSessions();
		await app.workbench.console.executeCode('Python', 'import ipykernel; ipykernel.__file__');
		await app.workbench.console.waitForConsoleContents('site-packages');
		await sessions.deleteAll();
	});
});
