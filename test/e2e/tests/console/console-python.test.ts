/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Pane: Python', { tag: [tags.WEB, tags.CONSOLE, tags.WIN] }, () => {

	test('Python - queue user input while interpreter is starting', async function ({ app, sessions }) {
		await sessions.startAndSkipMetadata({ language: 'Python', waitForReady: false });
		await app.workbench.console.executeCode('Python', 'import time; time.sleep(5); print("done");',);
		await app.workbench.console.waitForConsoleContents('done', { expectedCount: 2, timeout: 30000 });
	});

	test('Python - Verify cancel button on console bar', async function ({ app, python }) {
		await app.workbench.console.executeCode('Python', 'import time');
		await app.workbench.console.executeCode('Python', 'time.sleep(10)', { waitForReady: false });
		await app.workbench.console.interruptExecution();
	});
});

// This nesting is necessary because the settings fixture must be used in a
// beforeAll hook to ensure app instances pass to test correctly
test.describe('Console Pane: Alternate Python', () => {

	test.beforeAll(async ({ settings }) => {
		await settings.set({ 'python.useBundledIpykernel': false }, { reload: true });
	});

	test('Verify alternate python can skip bundled ipykernel', async ({ app, sessions }) => {
		await expect(async () => {
			await sessions.start('pythonAlt');
			await app.workbench.console.clearButton.click();
			await app.workbench.console.executeCode('Python', 'import ipykernel; ipykernel.__file__');
			await app.workbench.console.waitForConsoleContents('site-packages');
		}).toPass({ timeout: 60000 });
	});

});
