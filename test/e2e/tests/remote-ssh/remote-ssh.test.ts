/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, Page } from 'playwright';
import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

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

async function waitForNewWindow(
	app: ElectronApplication,
	opts: {
		timeout?: number;
		// Any of these can help target the right window:
		urlIncludes?: string;
		titleIncludes?: string;
		selectorToAppear?: string; // e.g. a unique text or element that only exists in the SSH window
	} = {}
): Promise<Page> {
	const { timeout = 30_000, urlIncludes, titleIncludes, selectorToAppear } = opts;

	return await app.waitForEvent('window', {
		timeout,
		predicate: (w: Page) => {
			// Fast filters first
			if (urlIncludes && !w.url().includes(urlIncludes)) { return false; }
			// Title check (async) is handled below with best-effort
			return true;
		}
	}).then(async (w: Page) => {
		if (titleIncludes) {
			const t = await w.title();
			console.log(`Window title: ${t}`);
			if (!t.includes(titleIncludes)) { throw new Error('Not the SSH window'); }
		}
		if (selectorToAppear) {
			await w.locator(selectorToAppear).first().waitFor({ timeout });
		}
		await w.bringToFront();
		return w;
	});
}

test.describe('Remote SSH', {
	tag: [tags.REMOTE_SSH]
}, () => {

	test.beforeAll(async ({ }) => {
		try {
			sshKeyscan('127.0.0.1', 3456, '/tmp/known_hosts');
		} catch (err) {
			throw new Error(`ssh-keyscan failed: ${(err as Error).message}`);
		}

	});

	test('Verify SSH connection into docker image', async function ({ app, python }) {

		await app.code.driver.page.locator('.codicon-remote').click();

		// Usage around the action that opens the new window:
		const newWindowPromise = waitForNewWindow(app.code.electronApp!, {
			// Use whatever’s most stable in your app:
			urlIncludes: 'Positron',            // or leave out if not stable
			selectorToAppear: 'text=Setting up SSH Host remote'  // a unique bit of text in the new UI
		});

		await app.workbench.quickInput.waitForQuickInputOpened();
		await app.workbench.quickInput.selectQuickInputElementContaining('Connect to Host...');
		await app.workbench.quickInput.selectQuickInputElementContaining('remote');

		const sshWin = await newWindowPromise;

		await expect(sshWin.getByText('Enter password')).toBeVisible({ timeout: 60000 });

		await sshWin.keyboard.type('root');
		await sshWin.keyboard.press('Enter');

		//const alertLocator = sshWin.locator('.monaco-alert').getByText('Setting up SSH Host remote');

		const alertLocator = sshWin.locator('span', { hasText: 'Setting up SSH Host remote' });

		await expect(alertLocator).toBeVisible({ timeout: 10000 });
		await expect(alertLocator).not.toBeVisible({ timeout: 60000 });

	});
});

