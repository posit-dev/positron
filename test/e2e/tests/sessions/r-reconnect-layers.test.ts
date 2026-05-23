/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Sessions: R Reconnect Layers', {
	tag: [tags.CONSOLE, tags.SESSIONS, tags.ARK, tags.WEB, tags.WIN]
}, () => {

	test.beforeAll(async function ({ app, openFolder, settings }) {
		await settings.set({
			'interpreters.startupBehavior': 'auto'
		});
		await openFolder(join('qa-example-content/workspaces/r-session-hooks'));
		await app.workbench.console.waitForReadyAndStarted('>', 60000);
	});

	test('Layer 1: .Rprofile ran on startup', async function ({ app }) {
		const { console } = app.workbench;

		// The .Rprofile in this workspace does cat("[.Rprofile] top-level code executed\n")
		// Verify we can see that to confirm we're using the right .Rprofile (most basic confirmation)
		await console.waitForConsoleContents('[.Rprofile] top-level code executed', { timeout: 30000 });
	});

	test('Layer 2: Console accepts and displays code output after reload', async function ({ app, hotKeys }) {
		const { console } = app.workbench;

		await console.clearButton.click();
		await hotKeys.reloadWindow(true);
		await console.waitForReady('>', 60000);

		// Can we run code and see output? Most basic thing after reconnect (must work).
		await console.executeCode('R', 'cat("[layer2] hello")');
		// Use exact match so we don't also pick up the input line containing cat(...)
		await console.waitForConsoleContents('[layer2] hello', { timeout: 30000, exact: true });
	});

	test('Layer 3: Session is the same R process after reload (variable persists)', async function ({ app, hotKeys }) {
		const { console } = app.workbench;

		// Set something before reload to check survivability
		await console.executeCode('R', 'layer3_marker <- "survived"');
		await console.waitForReady('>');

		await console.clearButton.click();
		await hotKeys.reloadWindow(true);
		await console.waitForReady('>', 60000);

		// Query the variable: if it's there, same process
		await console.executeCode('R', 'cat(paste0("[layer3] marker=", layer3_marker))');
		await console.waitForConsoleContents('[layer3] marker=survived', { timeout: 30000, exact: true });
	});

	test('Layer 4: .Rprofile does NOT re-run after reload', async function ({ app, hotKeys }) {
		const { console } = app.workbench;

		await console.clearButton.click();
		await hotKeys.reloadWindow(true);
		await console.waitForReady('>', 60000);

		// .Rprofile top-level cat() should not appear in post-reload output (this should pass quickly after console is ready)
		await console.waitForConsoleContents('[.Rprofile] top-level code executed', { expectedCount: 0, timeout: 5000 });
	});

	test('Layer 5: Hook cat() output appears in console after reload without user action', async function ({ app, hotKeys }) {
		const { console } = app.workbench;

		await console.focus();
		await console.clearButton.click();
		await hotKeys.reloadWindow(true);
		await console.waitForReady('>', 60000);

		// The session_reconnect hook does cat("[hook:reconnect] fired\n")
		// This output should appear without executing anything
		// Set timeout to 60s instead to rule out Claude's confusing hypothesis of timing issue
		await console.waitForConsoleContents('[hook:reconnect] fired', { timeout: 60000 });
	});
});
