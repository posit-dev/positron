/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Page } from '@playwright/test';
import { test, tags } from '../_test.setup';
import { Application } from '../../infra';
import { createWorkbenchFromPage, waitForAnyNewWindow, Workbench } from '../../infra/workbench';

test.use({
	suiteId: __filename
});

// The WSL distro to connect to. Override with POSITRON_WSL_DISTRO; defaults to 'Ubuntu'.
const WSL_DISTRO = process.env.POSITRON_WSL_DISTRO || 'Ubuntu';

// A URL (typically file://) pointing at a Positron REH (remote extension host) tarball reachable
// from inside the distro, e.g. file:///mnt/c/path/to/positron-reh-linux-x64.tar.gz.
//
// This is required for dev builds: product.json carries no commit/version, so the default
// `remote.WSL.serverDownloadUrlTemplate` (a CDN URL with ${version}/${commit} placeholders)
// cannot be resolved and the server install would fail. Pointing at a local tarball with no
// placeholders sidesteps that. See the "Remote WSL Tests" section of test/e2e/README.md.
const WSL_SERVER_DOWNLOAD_URL = process.env.POSITRON_WSL_SERVER_DOWNLOAD_URL;

/**
 * Point the session picker at the interpreters installed inside the distro.
 *
 * `sessions.start()` reads POSITRON_PY_VER_SEL / POSITRON_R_VER_SEL to choose an interpreter. The
 * interpreters inside the distro differ from the local Windows ones, so allow overriding the
 * selectors with WSL-specific values (mirrors how remote-ssh overrides them with its *_REMOTE_*
 * vars). When the WSL-specific vars are unset, the local selectors are left in place so the picker
 * still has something to match.
 */
function useWslInterpreterSelectors(): void {
	if (process.env.POSITRON_PY_WSL_VER_SEL) {
		process.env.POSITRON_PY_VER_SEL = process.env.POSITRON_PY_WSL_VER_SEL;
	}
	if (process.env.POSITRON_R_WSL_VER_SEL) {
		process.env.POSITRON_R_VER_SEL = process.env.POSITRON_R_WSL_VER_SEL;
	}
}

/**
 * Connect Positron to {@link WSL_DISTRO} and return a workbench bound to the new remote window.
 *
 * Connecting opens the workbench in a fresh window (mirroring the remote-ssh flow) and, on the
 * first connect, installs/starts the remote server inside the distro -- a slow, one-time REH
 * download. Callers should mark their test `test.slow()` to absorb that.
 */
async function connectToWslDistro(app: Application): Promise<{ wslWin: Page; wslWorkbench: Workbench }> {
	return test.step(`Connect to WSL distro "${WSL_DISTRO}"`, async () => {
		// Connecting opens the workbench in a new window, so arm the listener before triggering.
		const wslWinPromise = waitForAnyNewWindow(app.code.electronApp!, async () => {
			// The remote-indicator entries ("Connect to WSL", "Connect to WSL using Distro...")
			// reuse the current window. Invoke the "in New Window" variant from the Command
			// Palette instead so we get a fresh window to drive, mirroring the remote-ssh flow.
			//
			// `keepOpen` is essential: this command chains straight into the "Select WSL distro"
			// quick pick, so the quick-input box never disappears -- it morphs from the command
			// palette into the distro picker. Without `keepOpen`, runCommand's default
			// `waitForQuickInputClosed()` races that morph and intermittently times out on a cold
			// machine (the palette and the distro picker share the same input element, so there is
			// often no frame where it reads as closed). `keepOpen` skips that close-check.
			await app.workbench.quickaccess.runCommand('openremotewsl.connectUsingDistroInNewWindow', { keepOpen: true });

			// Pick the target distro from the distro quick pick the command opens. Allow a generous
			// timeout to absorb a cold `wsl --list` enumeration on CI (the default actionTimeout is
			// 15s, which can be tight on a freshly provisioned runner).
			await app.workbench.quickInput.waitForQuickInputOpened();
			await app.workbench.quickInput.selectQuickInputElementContaining(WSL_DISTRO, { timeout: 30_000 });
		}, { timeout: 60_000 });

		const wslWin = await wslWinPromise;

		// The resolver shows a "Setting up WSL Distro: <distro>" notification while it installs and
		// starts the server. Once connected, the remote indicator reads "WSL: <distro>". Allow a
		// generous timeout to cover the one-time server install.
		const remoteIndicator = wslWin.locator('.statusbar-item[id="status.host"]');
		await expect(remoteIndicator).toContainText(`WSL: ${WSL_DISTRO}`, { timeout: 180_000 });

		const wslWorkbench = createWorkbenchFromPage(app.code, wslWin);
		return { wslWin, wslWorkbench };
	});
}

test.describe('Remote WSL', {
	tag: [tags.REMOTE_WSL]
}, () => {

	test.beforeAll(async ({ settings }) => {
		// `remote.WSL.serverDownloadUrlTemplate` is an application-scoped setting, so it must live in
		// user settings (which `settings.set` writes). The WSL resolver reads it when installing the
		// server inside the distro.
		if (WSL_SERVER_DOWNLOAD_URL) {
			await settings.set({ 'remote.WSL.serverDownloadUrlTemplate': WSL_SERVER_DOWNLOAD_URL });
		}
	});

	test('Verify Positron connects to a WSL distro', async function ({ app }) {
		// Connecting installs/starts the remote server in the distro the first time, which can be
		// slow (a cold REH download). Triple the default test timeout to absorb that.
		test.slow();

		const { wslWorkbench } = await connectToWslDistro(app);

		await test.step('Verify the remote runs in Linux', async () => {
			// A trivial liveness check that proves the workbench is executing inside the distro:
			// `uname` prints "Linux" (only in the output, not the echoed command).
			await wslWorkbench.terminal.createTerminal();
			await wslWorkbench.terminal.runCommandInTerminal('uname');
			await wslWorkbench.terminal.waitForTerminalText('Linux');
		});
	});

	test('Verify Python code runs in a WSL distro', async function ({ app }) {
		// Reconnecting may still pay for a cold REH download if this test runs first.
		test.slow();

		useWslInterpreterSelectors();
		const { wslWorkbench } = await connectToWslDistro(app);

		await test.step('Start a Python session and evaluate code', async () => {
			await wslWorkbench.sessions.start('python');

			// Round-trip a trivial expression through the console, then confirm the result both in
			// the console output and as a variable surfaced in the Variables pane.
			await wslWorkbench.console.pasteCodeToConsole('x = 41 + 1; print(x)', true);
			await wslWorkbench.console.waitForConsoleContents('42');
			await wslWorkbench.variables.expectVariableToBe('x', '42');
		});
	});

	test('Verify R code runs in a WSL distro', async function ({ app }) {
		// Reconnecting may still pay for a cold REH download if this test runs first.
		test.slow();

		useWslInterpreterSelectors();
		const { wslWorkbench } = await connectToWslDistro(app);

		await test.step('Start an R session and evaluate code', async () => {
			await wslWorkbench.sessions.start('r');

			// Round-trip a trivial expression through the console, then confirm the result both in
			// the console output and as a variable surfaced in the Variables pane.
			await wslWorkbench.console.pasteCodeToConsole('x <- 41 + 1; print(x)', true);
			await wslWorkbench.console.waitForConsoleContents('42');
			await wslWorkbench.variables.expectVariableToBe('x', '42');
		});
	});
});
