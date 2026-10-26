/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
"Python: Create Environment..." from the palette with the Conda provider (#14350).

Conda has a different backend from venv, so this checks the same two things for it:
Positron registers the new environment in the session picker without "Discover All
Interpreters", and the Console starts it. The existing-environment branches are
covered by the venv test; conda creation is too slow to repeat them here.

Not tagged for Windows: conda breaks interpreter selection there (see the New Folder
flow tests).
*/

import * as path from 'path';
import { spawnSync } from 'child_process';
import { test as base, tags } from '../_test.setup';
import { expectEnvStarted, expectRuntimeListedOnce, openEmptyWorkspace, runCreateEnvironment } from './helpers/create-environment.js';

const test = base.extend<{}, {}>({
	beforeApp: [
		async ({ settingsFile }, use) => {
			await settingsFile.append({ 'interpreters.startupBehavior': 'auto' });
			await use();
		},
		{ scope: 'worker' }
	],
});

test.use({
	suiteId: __filename
});

const WORKSPACE_NAME = 'create-env-conda-test';

function hasConda(): boolean {
	return !!process.env.CONDA_EXE || spawnSync('conda', ['--version']).status === 0;
}

test.describe('Create Environment: Conda', {
	tag: [tags.INTERPRETER, tags.PYTHON, tags.WEB]
}, () => {
	test.skip(process.env.IS_OPENSUSE === 'true', 'Skip on openSuse');
	test.skip(!hasConda(), 'conda is not installed');
	test.slow();

	test('Create conda env from the palette starts it in the Console', async function ({ app, sessions }) {
		await openEmptyWorkspace(app, WORKSPACE_NAME);
		await sessions.expectNoStartUpMessaging();
		await sessions.expectAllSessionsToBeReady();

		await runCreateEnvironment(app, 'Conda');
		// The first entry is the recommended Python version. Click it once: the
		// re-click loop in the default mode races the picker closing.
		await app.workbench.quickInput.selectQuickInputElement(0, true);
		await app.workbench.quickInput.waitForQuickInputClosed();

		// Creation downloads Python, so allow well beyond the usual startup wait.
		await expectEnvStarted(app, new RegExp(`\\(Conda: ${WORKSPACE_NAME}\\) started`), { timeout: 240000 });
		await expectRuntimeListedOnce(sessions, path.join(WORKSPACE_NAME, '.conda'));
	});
});
