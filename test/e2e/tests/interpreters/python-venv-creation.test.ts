/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
End-to-end smoke for Python venv auto-creation: open a workspace with a
requirements.txt, accept the prompt, and confirm uv actually creates the .venv.

The prompt's gating decision (requirements present, no existing venv/conda, a
global interpreter selected, etc.) is pure logic covered deterministically by
positron-python's unit tests -- see
extensions/positron-python/src/test/pythonEnvironments/creation/createEnvironmentTrigger.unit.test.ts
(including the "selected python is not global" branch). This E2E only covers
the one thing those can't: the real create-venv flow through the UI and uv.
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
});
