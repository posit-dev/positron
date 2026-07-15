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
	test.slow();

	test('Clicking Yes creates venv', async function ({ app, openFolder }) {
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
		await openFolder('workspaces/python-venv-creation/with-requirements');
		await app.workbench.sessions.expectNoStartUpMessaging();

		const toast = app.workbench.toasts.toastNotification.filter({ hasText: /requirements\.txt/ });
		await expect(toast).toBeVisible({ timeout: 60000 });
		await app.workbench.toasts.expectToastWithTitle(/uv/);
		await app.workbench.toasts.closeWithHeader(/requirements\.txt/);
	});

	test('No notification when .venv already exists', async function ({ app, openFolder }) {
		await openFolder('with-existing-venv');

		await app.workbench.toasts.expectToastWithTitleNotToAppear(/requirements\.txt/);
	});
});
