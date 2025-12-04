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
		await app.workbench.console.executeCode('Python', 'import time; time.sleep(5); print("done");',);
		await app.workbench.console.waitForConsoleContents('done', { expectedCount: 2, timeout: 30000 });
	});

	test('Python - Verify cancel button on console bar', async function ({ app, python }) {
		await app.workbench.console.clearButton.click();
		await app.workbench.console.executeCode('Python', 'import time');
		await app.workbench.console.executeCode('Python', 'time.sleep(10)', { waitForReady: false });
		await app.workbench.console.interruptExecution();
	});

	test('Python - Verify console commands are queued during execution', async function ({ app, python }) {
		await app.workbench.console.clearButton.click();
		await app.workbench.console.pasteCodeToConsole('123 + 123');
		await app.workbench.console.executeCode('Python', '456 + 456');

		await app.workbench.console.waitForConsoleContents('912', { expectedCount: 1, timeout: 10000 });
		await app.workbench.console.waitForConsoleContents('123 + 123', { expectedCount: 1, timeout: 10000 });
		await app.workbench.console.waitForConsoleContents('246', { expectedCount: 0, timeout: 5000 });

	});

	test('Python - Verify interrupt stops execution mid-work', async function ({ app, python }) {
		// Execute code that does work in a loop and prints progress
		const code = `
import time
for i in range(10):
	print(f"Step {i}")
	time.sleep(1)
print("Completed all steps")
`;
		await app.workbench.console.clearButton.click();
		await app.workbench.console.executeCode('Python', code, { waitForReady: false });

		// Wait for some work to be done (at least 2-3 steps)
		await app.workbench.console.waitForConsoleContents('Step 2', { expectedCount: 1, timeout: 10000 });

		// Interrupt the execution
		await app.workbench.console.interruptExecution();

		// Wait for KeyboardInterrupt to appear
		await app.workbench.console.waitForConsoleContents('KeyboardInterrupt', { expectedCount: 1, timeout: 5000 });

		// Verify that some work was done (we saw Step 2)
		await app.workbench.console.waitForConsoleContents('Step 2', { expectedCount: 1, timeout: 1000 });

		// Verify that not all work was completed (Step 9 should not appear)
		await app.workbench.console.waitForConsoleContents('Step 9', { expectedCount: 0, timeout: 1000 });
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
		await app.workbench.console.clearButton.click();
		await app.workbench.console.executeCode('Python', 'import ipykernel; ipykernel.__file__');
		await app.workbench.console.waitForConsoleContents('site-packages');
	});

});
