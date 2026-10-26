/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
"Python: Create Environment..." from the palette with the Venv provider (#14350).

positron-python's unit tests cover the provider flow itself. These cover what they
cannot: Positron registers the new venv in the session picker without "Discover All
Interpreters", the Console starts it, "Use Existing" leaves the running console alone,
and "Delete and Recreate" replaces the console without duplicating the picker entry.

interpreters.startupBehavior is 'auto' so a session is already running before the
venv exists; the Use Existing check compares session counts against that baseline.
*/

import * as path from 'path';
import { test as base, expect, tags } from '../_test.setup';
import { expectEnvStarted, expectRuntimeListedOnce, openEmptyWorkspace, pickExistingEnvAction, pickFirstVenvBaseInterpreter, runCreateEnvironment } from './helpers/create-environment.js';

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

const WORKSPACE_NAME = 'create-env-venv-test';
const VENV_PATH_FRAGMENT = path.join(WORKSPACE_NAME, '.venv');
// A venv built on a uv-managed base Python is classified as uv, which is the case on
// some runners, so the session name may carry either source.
const VENV_STARTED = new RegExp(`\\((Venv|uv): ${WORKSPACE_NAME}\\) started`);

test.describe('Create Environment: Venv', {
	tag: [tags.INTERPRETER, tags.PYTHON, tags.WEB]
}, () => {
	test.skip(process.env.IS_OPENSUSE === 'true', 'Skip on openSuse');
	test.describe.configure({ mode: 'serial' });

	let venvSessionId: string | undefined;
	let sessionCount: number;

	test.beforeAll(async ({ app, sessions }) => {
		await openEmptyWorkspace(app, WORKSPACE_NAME);
		await sessions.expectNoStartUpMessaging();
		await app.workbench.sessions.expectAllSessionsToBeReady();
	});

	test('Create venv from the palette starts it in the Console', async function ({ app, sessions }) {
		await runCreateEnvironment(app, 'Venv');
		await pickFirstVenvBaseInterpreter(app);

		await expectEnvStarted(app, VENV_STARTED);
		await expectRuntimeListedOnce(sessions, VENV_PATH_FRAGMENT);

		venvSessionId = await sessions.getForegroundSessionId();
		sessionCount = await sessions.getSessionCount();
		expect(venvSessionId).toBeDefined();
	});

	test('Use Existing keeps the running venv console', async function ({ app, sessions }) {
		await runCreateEnvironment(app, 'Venv');
		await pickExistingEnvAction(app, 'Use Existing');
		await app.workbench.quickInput.waitForQuickInputClosed();

		// The picker check comes first: it takes a few seconds, which is the window a
		// wrongly started session would need to show up in the counts below.
		await expectRuntimeListedOnce(sessions, VENV_PATH_FRAGMENT);
		await sessions.expectSessionCountToBe(sessionCount);
		expect(await sessions.getForegroundSessionId()).toBe(venvSessionId);
	});

	test('Delete and Recreate starts a fresh venv console', async function ({ app, sessions }) {
		await runCreateEnvironment(app, 'Venv');
		await pickExistingEnvAction(app, 'Delete and Recreate');
		await pickFirstVenvBaseInterpreter(app);

		await sessions.expectSessionToBeGone(venvSessionId!, { timeout: 60000 });
		await expectEnvStarted(app, VENV_STARTED);
		await expect.poll(() => sessions.getForegroundSessionId(), { timeout: 60000 }).not.toBe(venvSessionId);
		await expectRuntimeListedOnce(sessions, VENV_PATH_FRAGMENT);
	});
});
