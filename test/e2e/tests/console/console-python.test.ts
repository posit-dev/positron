/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Pane: Python', { tag: [tags.WEB, tags.CONSOLE, tags.WIN] }, () => {

	test('Python - queue user input while interpreter is starting', async function ({ app, sessions }) {
		await sessions.startAndSkipMetadata({ language: 'Python', waitForReady: false });
		await app.positron.console.executeCode('Python', 'import time; time.sleep(5); print("done");',);
		await app.positron.console.waitForConsoleContents('done', { expectedCount: 2, timeout: 30000 });
	});

	test('Python - Verify cancel button on console bar', async function ({ app, python }) {
		await app.positron.console.executeCode('Python', 'import time');
		await app.positron.console.executeCode('Python', 'time.sleep(10)', { waitForReady: false });
		await app.positron.console.interruptExecution();
	});

	test('Python - Verify console commands are queued during execution', async function ({ app, python }) {
		await app.positron.console.pasteCodeToConsole('123 + 123');
		await app.positron.console.executeCode('Python', '456 + 456');

		await app.positron.console.waitForConsoleContents('912', { expectedCount: 1, timeout: 10000 });
		await app.positron.console.waitForConsoleContents('123 + 123', { expectedCount: 1, timeout: 10000 });
		await app.positron.console.waitForConsoleContents('246', { expectedCount: 0, timeout: 5000 });

	});

});

// This nesting is necessary because the settings fixture must be used in a
// beforeAll hook to ensure app instances pass to test correctly
test.describe('Console Pane: Alternate Python', { tag: [tags.WEB, tags.CONSOLE, tags.WIN] }, () => {

	test.beforeAll(async ({ settings, app }) => {
		await settings.set({ 'python.useBundledIpykernel': false });
		await app.restart();
	});

	test('Verify alternate python can skip bundled ipykernel', async ({ app, sessions }) => {
		await sessions.start('pythonAlt');
		await app.positron.console.clearButton.click();
		await app.positron.console.executeCode('Python', 'import ipykernel; ipykernel.__file__');
		await app.positron.console.waitForConsoleContents('site-packages');
	});

});
