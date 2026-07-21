/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
Summary:
- Verifies the Python venv auto-creation notification flow.
- Requires a global Python interpreter (non-venv, non-conda) for the trigger to fire.
- Tests run in sequence; each openFolder changes the workspace, so paths are
	relative to where the picker starts after the previous test.

|Test              |Workspace                     |Expected behavior                  |
|------------------|------------------------------|-----------------------------------|
|Clicking Yes      |temp dir with requirements.txt|Notification appears, .venv created|
|Notification shows|fixture with requirements.txt |Toast mentions requirements.txt + uv|
|No notification   |fixture with existing .venv   |No toast appears                   |
*/

import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { test as base, expect, tags } from '../_test.setup';

const test = base.extend<{}, {}>({
	beforeApp: [
		async ({ settingsFile }, use) => {
			await settingsFile.append({
				'python.createEnvironment.trigger': 'prompt',
				'interpreters.startupBehavior': 'auto',
				'python.defaultInterpreterPath': '/usr/bin/python3',
				// Override the Docker fixture's interpreters.include (settingsDocker.json),
				// which force-includes /root/.venv -- a uv venv on the CI image. When that
				// venv wins the workspace's active-interpreter selection, the create-env
				// prompt is suppressed (it only fires for a global interpreter), so the
				// requirements.txt notification never appears. Clearing the include leaves
				// the global /usr/bin/python as the unambiguous selection.
				'python.interpreters.include': [],
			});
			await use();
		},
		{ scope: 'worker' }
	],
});

test.use({
	suiteId: __filename
});

test.describe('Python Venv Auto-Creation', {
	tag: [tags.INTERPRETER, tags.WEB]
}, () => {
	test.skip(process.env.IS_OPENSUSE === 'true', 'Skip on openSuse');

	test('Clicking Yes creates venv', async function ({ app, openFolder }) {
		// Real venv creation (~35s avg in CI, with 60s waits below); the other
		// two tests are fast and run under the normal timeout.
		test.slow();
		const tempWorkspace = path.join(os.tmpdir(), 'vscsmoke', 'test-files', 'venv-creation-test');
		await fs.mkdir(tempWorkspace, { recursive: true });
		await fs.writeFile(path.join(tempWorkspace, 'requirements.txt'), 'requests\n');

		try {
			await openFolder('test-files/venv-creation-test');
			await app.workbench.sessions.expectNoStartUpMessaging();

			const toast = app.workbench.toasts.toastNotification.filter({ hasText: /requirements\.txt/ });
			await expect(toast).toBeVisible({ timeout: 60000 });
			await app.workbench.toasts.clickButton('Yes', { notificationFilter: /requirements\.txt/ });

			const venvPath = path.join(tempWorkspace, '.venv');
			await expect(async () => {
				await fs.access(venvPath);
			}).toPass({ timeout: 60000 });
		} finally {
			await fs.rm(tempWorkspace, { recursive: true, force: true }).catch(() => { });
		}
	});

	test('Notification appears for workspace with requirements.txt', async function ({ app, openFolder }) {
		// Absolute path so the test is independent of the workspace left by the
		// preceding test (and survives a retry, which relaunches at the default
		// workspace). See the openFolder fixture's absolute-path branch.
		const requirementsWorkspace = path.join(os.tmpdir(), 'vscsmoke', 'test-files', 'workspaces', 'python-venv-creation', 'with-requirements');
		await openFolder(requirementsWorkspace);
		await app.workbench.sessions.expectNoStartUpMessaging();

		const toast = app.workbench.toasts.toastNotification.filter({ hasText: /requirements\.txt/ });
		await expect(toast).toBeVisible({ timeout: 60000 });
		await app.workbench.toasts.expectToastWithTitle(/uv/);
		await app.workbench.toasts.closeWithHeader(/requirements\.txt/);
	});

	test('No notification when .venv already exists', async function ({ app, openFolder }) {
		// Absolute path so the test is independent of the workspace left by the
		// preceding test (and survives a retry, which relaunches at the default
		// workspace). See the openFolder fixture's absolute-path branch.
		const venvWorkspace = path.join(os.tmpdir(), 'vscsmoke', 'test-files', 'workspaces', 'python-venv-creation', 'with-existing-venv');
		await openFolder(venvWorkspace);

		await app.workbench.toasts.expectToastWithTitleNotToAppear(/requirements\.txt/);
	});
});
