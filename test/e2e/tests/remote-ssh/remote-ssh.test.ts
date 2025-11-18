/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, Page } from 'playwright';
import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createWorkbenchFromPage } from '../../infra/workbench';
import { pythonDynamicPlot } from '../shared/plots.constants.js';
const settingsPath = require('node:path').resolve(__dirname, '../../fixtures/settingsDocker.json');

test.use({
	suiteId: __filename
});

function sshKeyscan(host: string, port: number, knownHostsPath: string) {
	// Run ssh-keyscan and capture stdout (the host keys)
	const out = execFileSync('ssh-keyscan', ['-p', String(port), host], {
		stdio: ['ignore', 'pipe', 'inherit'],
	});
	// Ensure the file exists, then append
	fs.mkdirSync(require('node:path').dirname(knownHostsPath), { recursive: true });
	fs.appendFileSync(knownHostsPath, out);
}

async function waitForAnyNewWindow(
	app: ElectronApplication,
	trigger?: () => Promise<void> | void,
	opts: { timeout?: number; loadState?: 'load' | 'domcontentloaded' | 'networkidle' } = {}
): Promise<Page> {
	const { timeout = 30_000, loadState = 'domcontentloaded' } = opts;

	// Snapshot existing windows so we can detect a new one even if the event is missed.
	const before = new Set(app.windows());

	// Start waiting for a new 'window' event *before* we trigger anything.
	const eventWait = app.waitForEvent('window', { timeout }).catch(() => null);

	// Optionally run whatever opens the window (recommended).
	if (trigger) { await trigger(); }

	// If we caught the event, great.
	let win = await eventWait;

	// Fallback: CI flake where window opened before listener—scan for any new page.
	if (!win) {
		const start = Date.now();
		while (Date.now() - start < timeout) {
			const current = app.windows();
			for (const p of current) {
				if (!before.has(p)) {
					win = p;
					break;
				}
			}
			if (win) { break; }
			await new Promise(r => setTimeout(r, 100));
		}
	}

	if (!win) { throw new Error('No new window appeared within timeout'); }

	// Ensure it’s at least minimally ready and on top
	await win.waitForLoadState(loadState).catch(() => { });
	await win.bringToFront().catch(() => { });
	return win;
}


test.describe('Remote SSH', {
	tag: [tags.REMOTE_SSH]
}, () => {

	test.beforeAll(async ({ settings }) => {

		try {
			sshKeyscan('127.0.0.1', 3456, '/tmp/known_hosts');
		} catch (err) {
			throw new Error(`ssh-keyscan failed: ${(err as Error).message}`);
		}

		await settings.set(JSON.parse(fs.readFileSync(settingsPath, 'utf8')));

	});

	test('Verify SSH connection into docker image', async function ({ app, python }) {

		const sshWin = await test.step(`Connect to docker image`, async () => {
			// Start waiting for *any* new window before we trigger the UI that opens it
			const sshWinPromise = waitForAnyNewWindow(app.code.electronApp!, async () => {
				await app.workbench.quickInput.waitForQuickInputOpened();
				await app.workbench.quickInput.selectQuickInputElementContaining('Connect to Host...');
				await app.workbench.quickInput.selectQuickInputElementContaining('remote');
			}, { timeout: 60_000 });

			// Kick off the action that reveals the quick input (if needed)
			await app.code.driver.page.locator('.codicon-remote').click();

			// Grab the new window (no URL/title/selector filtering)
			const sshWin = await sshWinPromise;

			// Continue as before
			await expect(sshWin.getByText('Enter password')).toBeVisible({ timeout: 60_000 });
			await sshWin.keyboard.type('root');
			await sshWin.keyboard.press('Enter');

			const alertLocator = sshWin.locator('span', { hasText: 'Setting up SSH Host remote' });
			await expect(alertLocator).toBeVisible({ timeout: 10_000 });
			await expect(alertLocator).not.toBeVisible({ timeout: 60_000 });

			return sshWin;
		});

		const sshWorkbench = await test.step(`Create a workbench instance from the remote page`, async () => {
			const sshWorkbench = createWorkbenchFromPage(app.code, sshWin);

			process.env.POSITRON_PY_VER_SEL = process.env.POSITRON_PY_REMOTE_VER_SEL!;
			process.env.POSITRON_R_VER_SEL = process.env.POSITRON_R_REMOTE_VER_SEL!;

			return sshWorkbench;
		});


		const pythonSession = await test.step(`Check that correct Python is being used`, async () => {
			const pythonSession = await sshWorkbench.sessions.start('python');
			await sshWorkbench.console.pasteCodeToConsole('import sys; print(sys.executable)', true);
			await sshWorkbench.console.waitForConsoleContents('/root/.venv/bin/python');

			return pythonSession;

		});

		await test.step(`Check that correct R is being used`, async () => {
			await sshWorkbench.sessions.start('r');
			await sshWorkbench.console.pasteCodeToConsole('Sys.getenv("R_HOME")', true);
			await sshWorkbench.console.waitForConsoleContents('/opt/R/4.4.0/lib/R');
		});

		await test.step(`Check that plots work`, async () => {
			await sshWorkbench.sessions.select(pythonSession.id);
			await sshWorkbench.console.pasteCodeToConsole(pythonDynamicPlot, true);
			await sshWorkbench.plots.waitForCurrentPlot();
		});

	});
});

