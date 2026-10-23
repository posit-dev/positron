/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { Application, Sessions } from '../../../infra/index.js';
import { expect, test } from '../../_test.setup.js';

/**
 * Create an empty workspace for a Create Environment test and open it.
 *
 * The workspace sits beside the shared e2e workspace, not inside it. The new
 * environment is left behind, and Positron discovers environments under any folder
 * it opens: a leftover venv with the primary Python version inside the shared
 * workspace outranks the global interpreter in later tests' kernel pickers. It is
 * removed at the start rather than the end, since its session may still be starting
 * when the test ends and removing the folder then fails the kernel launch.
 *
 * The folder is opened by its resolved path, not through the `openFolder` fixture.
 * On macOS the temp dir is reached through /var -> /private/var, and a workspace
 * opened under the symlink spelling makes Positron register the new environment
 * once per spelling (#16861). CI runners have no such symlink.
 */
export async function openEmptyWorkspace(app: Application, name: string) {
	const workspace = path.join(os.tmpdir(), 'vscsmoke', 'create-env', name);
	await fs.promises.rm(workspace, { recursive: true, force: true });
	await fs.promises.mkdir(workspace, { recursive: true });
	const realWorkspace = await fs.promises.realpath(workspace);

	await test.step(`Open folder: ${realWorkspace}`, async () => {
		const { hotKeys, quickInput } = app.workbench;
		await hotKeys.openFolder();
		await quickInput.waitForQuickInputOpened();
		await quickInput.type(realWorkspace + path.sep);
		await quickInput.clickOkButton();
		// Opening a folder reloads the workbench.
		await app.code.driver.currentPage.waitForTimeout(3000);
		await app.code.driver.currentPage.locator('.monaco-workbench').waitFor({ state: 'visible' });
	});
}

export async function runCreateEnvironment(app: Application, provider: 'Venv' | 'Conda') {
	await test.step(`Run Python: Create Environment and pick ${provider}`, async () => {
		await app.workbench.quickaccess.runCommand('python.createEnvironment', { keepOpen: true });
		await app.workbench.quickInput.selectQuickInputElementContaining(provider, { timeout: 30000 });
	});
}

export async function pickExistingEnvAction(app: Application, action: 'Use Existing' | 'Delete and Recreate') {
	await test.step(`Pick existing environment action: ${action}`, async () => {
		await app.workbench.quickInput.selectQuickInputElementContaining(action, { timeout: 30000 });
	});
}

/**
 * Pick the first base interpreter the venv picker offers.
 *
 * The picker only offers interpreters the extension types as global. That excludes
 * pyenv installs (typed as virtual), so the usual alternate interpreter cannot be
 * named here; the first entry is whatever ranks highest on the machine.
 */
export async function pickFirstVenvBaseInterpreter(app: Application) {
	await test.step('Pick the first base interpreter offered', async () => {
		const row = app.workbench.quickInput.rowByAriaLabelPrefix('Python ').first();
		await expect(row).toBeVisible({ timeout: 30000 });
		await row.click();
	});
}

/**
 * Wait for the Console to report the new environment's session started. Creation
 * time counts toward the timeout, so callers pass a longer one for slow backends.
 */
export async function expectEnvStarted(app: Application, pattern: RegExp, { timeout = 90000 } = {}) {
	await test.step(`Verify environment starts: ${pattern}`, async () => {
		await app.workbench.console.waitForConsoleContents(pattern, { timeout });
	});
}

/**
 * Verify the session picker lists exactly one runtime whose path contains
 * `pathFragment`, without running "Discover All Interpreters": the point is that
 * Positron registered the new environment on its own.
 *
 * Paths are compared after resolving symlinks, so a /var and /private/var pair on
 * macOS counts once while a true duplicate still fails.
 */
export async function expectRuntimeListedOnce(sessions: Sessions, pathFragment: string, { timeout = 60000 } = {}) {
	await test.step(`Verify session picker lists ${pathFragment} once`, async () => {
		await expect.poll(async () => {
			const runtimes = await sessions.getAllAvailableRuntimes();
			const matching = runtimes.filter(runtime => runtime.path.includes(pathFragment)).map(runtime => runtime.path);
			const realPaths = await Promise.all(matching.map(p => fs.promises.realpath(p).catch(() => p)));
			return [...new Set(realPaths)];
		}, { timeout }).toHaveLength(1);
	});
}
