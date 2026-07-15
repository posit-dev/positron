/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createWorkbenchFromPage, waitForAnyNewWindow } from '../../infra/workbench';
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

	test('Verify SSH connection into docker image', async function ({ app, python, runDockerCommand }) {

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


		const pythonSession = await test.step(`Check that correct Python is being used`, async () => {
			// The remote host has both a base interpreter and the project venv at this
			// version; startAndSkipMetadata deprioritizes base installs so the
			// uv-managed /root/.venv is selected (verified by the assertion below).
			// The version comes from POSITRON_PY_REMOTE_VER_SEL (set in the yml).
			const pythonSessionId = await sshWorkbench.sessions.startAndSkipMetadata({
				language: 'Python',
				version: process.env.POSITRON_PY_REMOTE_VER_SEL,
			});
			const pythonSession = await sshWorkbench.sessions.getMetadata(pythonSessionId);
			await sshWorkbench.console.pasteCodeToConsole('import sys; print(sys.executable)', true);
			await sshWorkbench.console.waitForConsoleContents('/root/.venv/bin/python');

			return pythonSession;

		});

		await test.step(`Check that correct R is being used`, async () => {
			await sshWorkbench.sessions.start('r');
			await sshWorkbench.console.pasteCodeToConsole('Sys.getenv("R_HOME")', true);
			await sshWorkbench.console.waitForConsoleContents('/opt/R/4.5.2/lib/R');
		});

		await test.step(`Check that plots work`, async () => {
			await sshWorkbench.sessions.select(pythonSession.id);
			await sshWorkbench.console.pasteCodeToConsole(pythonDynamicPlot, true);
			await sshWorkbench.plots.waitForCurrentPlot();
		});

		await test.step(`Check that apps work`, async () => {
			const viewer = sshWorkbench.viewer;
			const fileName = 'Untitled-1';

			await sshWorkbench.layouts.enterLayout('stacked');

			await sshWorkbench.editors.newUntitledFile();
			await sshWorkbench.editor.selectTabAndType(fileName, flaskAppCode);
			await sshWin.keyboard.press('Enter');

			// Trigger Save (an untitled file, so this opens the Save As dialog).
			await sshWin.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');

			await sshWorkbench.quickInput.waitForQuickInputOpened();

			// The remote Save As dialog asynchronously re-populates its path
			// input with a suggested name derived from the file's first line,
			// which can clobber a single type() before we click OK. Retry the
			// type until "test.py" actually sticks. Use a short settle wait +
			// short assertion timeout so toPass can re-type quickly if the
			// value was reset (the default 15s expect timeout would block the
			// loop and only allow a couple of attempts).
			await expect(async () => {
				await sshWorkbench.quickInput.type('test.py');
				await sshWin.waitForTimeout(750); // let any async re-population land
				await expect(sshWorkbench.quickInput.quickInput).toHaveValue('test.py', { timeout: 1000 });
			}).toPass({ timeout: 30000 });

			await expect(async () => {
				await sshWorkbench.quickInput.clickOkButton();
				await sshWorkbench.quickInput.waitForQuickInputClosed();
			}).toPass({ timeout: 60000 });

			await sshWin.waitForTimeout(3000); // wait for file to be saved

			await sshWorkbench.editor.pressPlay();

			const viewerFrame = viewer.getViewerFrame();
			const loginLocator = app.web
				? viewerFrame.frameLocator('iframe').getByText('Hello, World!')
				: viewerFrame.getByText('Hello, World!');

			await expect(loginLocator).toBeVisible({ timeout: 60000 });
		});

		await test.step(`Clennup`, async () => {
			await runDockerCommand('docker exec test rm /test.py', 'Remove test.py from container');
		});

	});
});

// Built as an array of lines so the embedded Python keeps its 4-space indentation
// (it is typed into Monaco, which auto-indents new lines with spaces; a literal tab
// here would mix tabs and spaces and raise a Python TabError). Authoring the spaces
// as string content -- rather than source-line indentation -- also satisfies the
// tabs-only hygiene check.
const flaskAppCode = [
	'from flask import Flask',
	'',
	'app = Flask(__name__)',
	'',
	'@app.route(\'/\')',
	'def hello():',
	'    return \'Hello, World!\'',
	'',
	'if __name__ == \'__main__\':',
	'    app.run(debug=True)',
	'',
].join('\n');
