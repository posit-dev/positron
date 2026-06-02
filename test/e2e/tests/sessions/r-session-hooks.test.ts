/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Sessions: R Session Init Hooks', {
	tag: [tags.CONSOLE, tags.SESSIONS, tags.ARK, tags.WEB]
}, () => {

	test.beforeAll(async function ({ app, openFolder, settings }) {
		await settings.set({
			'interpreters.startupBehavior': 'auto'
		});
		await openFolder('qa-example-content/workspaces/r-session-hooks');
		await app.workbench.console.waitForReadyAndStarted('>', 60000);
	});

	test('R - New session runs .Rprofile and fires session_init with correct start_type', async function ({ app }) {
		const { console } = app.workbench;

		await console.waitForConsoleContents('[.Rprofile] top-level code executed', { timeout: 30000 });
		await console.waitForConsoleContents('[hook:init] start_type=new', { timeout: 30000 });

		// rstudioapi two-way calls work inside the hook
		await console.waitForConsoleContents('[hook:init] project=r-session-hooks', { timeout: 15000 });

		// navigateToFile triggers a UI action (opens DESCRIPTION in editor)
		await console.waitForConsoleContents('[hook:init] navigateToFile DESCRIPTION completed', { timeout: 15000 });
		await app.workbench.editors.waitForActiveTab('DESCRIPTION');
	});

	test('R - session_init hook receives correct console width', async function ({ app }) {
		test.skip(process.platform !== 'linux', 'Width propagation races with hook execution on macOS/Windows');
		const { console } = app.workbench;

		// Verify hook saw the actual console width by comparing to a live query
		const hookWidthLines = await console.waitForConsoleContents(/\[hook:init\] cli_width=\d+/, { timeout: 15000 });
		const hookWidth = Number(hookWidthLines[0].match(/cli_width=(\d+)/)![1]);

		await app.workbench.console.executeCode('R', 'cat(paste0("[live] width=", cli::console_width()))');
		const liveLines = await console.waitForConsoleContents(/\[live\] width=\d+/, { timeout: 15000 });
		const liveWidth = Number(liveLines[0].match(/width=(\d+)/)![1]);
		expect(hookWidth, 'hook cli::console_width() should match live console width').toBe(liveWidth);
	});

	test('R - Restart runs .Rprofile and fires session_init with start_type=restart', async function ({ app, sessions, hotKeys }) {
		const { console } = app.workbench;

		await hotKeys.closeAllEditors();
		const sessionId = await sessions.getCurrentSessionId();
		await sessions.restart(sessionId, { waitForIdle: true });

		await console.waitForConsoleContents('[.Rprofile] top-level code executed', { timeout: 30000 });
		await console.waitForConsoleContents('[hook:init] start_type=restart', { timeout: 30000 });
		await console.waitForConsoleContents('[hook:init] project=r-session-hooks', { timeout: 15000 });

		// navigateToFile works on restart too
		await console.waitForConsoleContents('[hook:init] navigateToFile DESCRIPTION completed', { timeout: 15000 });
		await app.workbench.editors.waitForActiveTab('DESCRIPTION');
	});

	test.skip('R - Window reload fires only session_reconnect, not session_init or .Rprofile', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/7593' }]
	}, async function ({ app, hotKeys }) {
		const { console } = app.workbench;

		await hotKeys.closeAllEditors();

		// Register a test hook that sets a queryable option when session_reconnect fires.
		// We can't rely on cat() output from hooks because in CI the console may not be
		// attached to the output stream yet when the hook runs.
		await console.executeCode('R', 'setHook("positron.session_reconnect", function() options(test_reconnect_fired = TRUE), action = "append")');
		await console.waitForReady('>');

		// Set a marker so we can verify session_init does NOT re-fire on reconnect
		await console.executeCode('R', 'assign(".positron_init_marker", TRUE, envir = globalenv())');
		await console.waitForReady('>');

		await console.focus();
		await console.clearButton.click();
		await hotKeys.reloadWindow(true);
		await console.waitForReady('>', 60000);

		// Verify session_reconnect hook fired via the queryable side effect
		await console.executeCode('R', 'cat(paste0("[verify] reconnect_fired=", isTRUE(getOption("test_reconnect_fired"))))');
		await console.waitForConsoleContents('[verify] reconnect_fired=TRUE', { timeout: 15000, exact: true });

		// Verify console width is correct after reconnect
		await console.executeCode('R', 'cat(paste0("[verify] width=", getOption("width")))');
		const widthLines = await console.waitForConsoleContents(/\[verify\] width=\d+/, { timeout: 15000 });
		const width = Number(widthLines[0].match(/width=(\d+)/)![1]);
		expect(width, 'console width should not be the R default 80').not.toBe(80);

		// Verify rstudioapi works after reconnect
		await console.executeCode('R', 'cat(paste0("[verify] project=", basename(rstudioapi::getActiveProject())))');
		await console.waitForConsoleContents('[verify] project=r-session-hooks', { timeout: 15000, exact: true });

		// session_init must NOT have fired on reconnect (marker survives because no restart)
		await console.executeCode('R', 'cat(paste0("[verify] marker_survived=", exists(".positron_init_marker", envir = globalenv())))');
		await console.waitForConsoleContents('[verify] marker_survived=TRUE', { timeout: 15000, exact: true });

		// .Rprofile must NOT have re-executed (it would print this to console)
		await console.waitForConsoleContents('[.Rprofile] top-level code executed', { expectedCount: 0, timeout: 5000 });
	});
});
