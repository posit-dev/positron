/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { test, expect } from '../_test.setup';
import { Application } from '../../infra';
import { createWorkbenchFromPage, waitForAnyNewWindow, Workbench } from '../../infra/workbench';

/**
 * Records the docker host's SSH keys so the connection can use
 * StrictHostKeyChecking (the workflow points the "remote" host at this file).
 * Call from `beforeAll` before {@link connectToRemoteHost}.
 */
export function sshKeyscan(host: string, port: number, knownHostsPath: string) {
	// Run ssh-keyscan and capture stdout (the host keys)
	const out = execFileSync('ssh-keyscan', ['-p', String(port), host], {
		stdio: ['ignore', 'pipe', 'inherit'],
	});
	// Ensure the file exists, then append
	fs.mkdirSync(path.dirname(knownHostsPath), { recursive: true });
	fs.appendFileSync(knownHostsPath, out);
}

/**
 * Connects to the docker SSH host and returns the remote window plus a
 * {@link Workbench} bound to it. Every page object on that workbench drives the
 * remote window, so a test reads the same as its local equivalent.
 *
 * Also repoints the interpreter-version env vars at the remote host's versions,
 * for tests that start sessions there.
 */
export async function connectToRemoteHost(app: Application): Promise<{ sshWin: Page; sshWorkbench: Workbench }> {
	const sshWin = await test.step(`Connect to docker image`, async () => {
		// Start waiting for *any* new window before we trigger the UI that opens it
		const sshWinPromise = waitForAnyNewWindow(app.code.electronApp!, async () => {
			await app.workbench.quickInput.waitForQuickInputOpened();
			await app.workbench.quickInput.selectQuickInputElementContaining('Connect to Host...');
			await app.workbench.quickInput.selectQuickInputElementContaining('remote');
		}, { timeout: 60_000 });

		// Kick off the action that reveals the quick input (if needed)
		await app.code.driver.currentPage.locator('.codicon-remote').click();

		// Grab the new window (no URL/title/selector filtering)
		const sshWin = await sshWinPromise;

		// Continue as before
		await expect(sshWin.getByText('Enter password')).toBeVisible({ timeout: 60_000 });
		await sshWin.keyboard.type('root');
		await sshWin.keyboard.press('Enter');

		const alertLocator = sshWin.locator('.statusbar-item-label', { hasText: 'Opening Remote' });
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

	return { sshWin, sshWorkbench };
}
