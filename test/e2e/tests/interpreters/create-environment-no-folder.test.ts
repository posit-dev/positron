/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
"Python: Create Environment..." from the palette with no folder open (#14350).

With no workspace folder the command offers a uv-backed global environment under
$WORKON_HOME instead of the provider list. This checks that the modal's create option
builds it, Positron registers it in the session picker without "Discover All
Interpreters", and the Console starts it.

WORKON_HOME points at a temp directory removed before the app starts, so the test
never touches ~/.virtualenvs on the runner and never finds a leftover environment
(Positron does not reuse or replace one that is already there).

Not tagged for the web lane: extraEnv only reaches the Electron process, so on the
web project WORKON_HOME is unset and the modal offers ~/.virtualenvs/positron on the
runner (confirmed on e2e-chromium, where the path assertion stopped the test).
*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { test as base, tags } from '../_test.setup';
import { expectRuntimeListedOnce } from './helpers/create-environment.js';

const WORKON_HOME = path.join(os.tmpdir(), 'vscsmoke', 'create-env-workon-home');
const GLOBAL_ENV_PATH = path.join(WORKON_HOME, 'positron');

const test = base.extend<{}, {}>({
	beforeApp: [
		async ({ }, use) => {
			await fs.promises.rm(WORKON_HOME, { recursive: true, force: true });
			await fs.promises.mkdir(WORKON_HOME, { recursive: true });
			await use();
		},
		{ scope: 'worker' }
	],
});

test.use({
	suiteId: __filename,
	extraEnv: { WORKON_HOME },
});

function hasUv(): boolean {
	return spawnSync('uv', ['--version']).status === 0;
}

test.describe('Create Environment: No Folder Open', {
	tag: [tags.INTERPRETER, tags.PYTHON]
}, () => {
	test.skip(process.env.IS_OPENSUSE === 'true', 'Skip on openSuse');
	test.skip(!hasUv(), 'uv is not installed');
	test.slow();

	test('Create global env from the palette starts it in the Console', async function ({ app, page, sessions }) {
		const { quickaccess, quickInput, dynamicModals, toasts } = app.workbench;

		await sessions.expectNoStartUpMessaging();

		// Closing the folder reloads the workbench.
		await quickaccess.runCommand('workbench.action.closeFolder');
		await page.waitForTimeout(3000);
		await page.locator('.monaco-workbench').waitFor({ state: 'visible' });
		await sessions.expectNoStartUpMessaging();

		await quickaccess.runCommand('python.createEnvironment');
		await dynamicModals.expectToBeVisible('Create a Python Environment', { timeout: 30000 });
		await dynamicModals.expectMessageToContain(GLOBAL_ENV_PATH);
		await dynamicModals.clickButton('Create Global Environment');

		// The first entry is the newest Python uv offers. Click it once: the re-click
		// loop in the default mode races the picker closing.
		await quickInput.waitForQuickInputOpened({ timeout: 60000 });
		await quickInput.selectQuickInputElement(0, true);
		await quickInput.waitForQuickInputClosed();

		// Info toasts auto-hide after 10s; waitForAppear also checks the notification
		// center, so no wait may come before it.
		await toasts.waitForAppear(/The following environment is selected/, { timeout: 240000 });
		await app.workbench.console.waitForConsoleContents(/\(uv: positron\) started/, { timeout: 90000 });
		await expectRuntimeListedOnce(sessions, GLOBAL_ENV_PATH);
	});
});
