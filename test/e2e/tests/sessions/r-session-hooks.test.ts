/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Sessions: R Session Init Hooks', {
	tag: [tags.CONSOLE, tags.SESSIONS, tags.ARK, tags.WIN, tags.WEB]
}, () => {

	test.beforeAll(async function ({ app, openFolder, settings }) {
		await settings.set({
			'interpreters.startupBehavior': 'auto'
		});
		await openFolder(path.join('qa-example-content/workspaces/r-session-hooks'));
		await app.workbench.console.waitForReadyAndStarted('>', 60000);
	});

	test('R - New session runs .Rprofile and fires session_init with correct start_type and console width', async function ({ app }) {
		const { console } = app.workbench;

		await console.waitForConsoleContents('[.Rprofile] top-level code executed', { timeout: 30000 });
		await console.waitForConsoleContents('[hook:init] start_type=new', { timeout: 30000 });

		// rstudioapi two-way calls work inside the hook
		await console.waitForConsoleContents('[hook:init] project=', { timeout: 15000 });

		// navigateToFile triggers a UI action (opens DESCRIPTION in editor)
		await console.waitForConsoleContents('[hook:init] navigateToFile DESCRIPTION completed', { timeout: 15000 });
		await app.workbench.editors.waitForActiveTab('DESCRIPTION');

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

		// navigateToFile works on restart too
		await console.waitForConsoleContents('[hook:init] navigateToFile DESCRIPTION completed', { timeout: 15000 });
		await app.workbench.editors.waitForActiveTab('DESCRIPTION');
	});

	test('R - Window reload fires only session_reconnect, not session_init or .Rprofile', async function ({ app, hotKeys }) {
		const { console } = app.workbench;

		await hotKeys.closeAllEditors();
		await app.workbench.console.clearButton.click();
		await hotKeys.reloadWindow(true);
		await console.waitForReady('>', 60000);

		// session_reconnect hook fires
		await console.waitForConsoleContents('[hook:reconnect] fired', { timeout: 30000 });

		// Verify hook saw the actual console width by comparing to a live query
		const hookWidthLines = await console.waitForConsoleContents(/\[hook:reconnect\] cli_width=\d+/, { timeout: 15000 });
		const hookWidth = Number(hookWidthLines[0].match(/cli_width=(\d+)/)![1]);

		await app.workbench.console.executeCode('R', 'cat(paste0("[live] width=", cli::console_width()))');
		const liveLines = await console.waitForConsoleContents(/\[live\] width=\d+/, { timeout: 15000 });
		const liveWidth = Number(liveLines[0].match(/width=(\d+)/)![1]);
		expect(hookWidth, 'reconnect hook cli::console_width() should match live console width').toBe(liveWidth);

		// rstudioapi works on reconnect
		await console.waitForConsoleContents('[hook:reconnect] project=r-session-hooks', { timeout: 15000 });

		// session_init must NOT fire on reconnect
		await console.waitForConsoleContents('[hook:init]', { expectedCount: 0, timeout: 5000 });

		// .Rprofile top-level must NOT re-execute on reconnect
		await console.waitForConsoleContents('[.Rprofile] top-level code executed', { expectedCount: 0, timeout: 5000 });
	});
});
