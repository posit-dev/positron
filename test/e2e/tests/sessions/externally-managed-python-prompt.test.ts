/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'child_process';
import { test as base, tags } from '../_test.setup';
import { Application } from '../../infra';

const test = base.extend<{}, {}>({
	beforeApp: [
		async ({ settingsFile }, use) => {
			await settingsFile.append({
				'python.createEnvironment.promptOnInterpreterSelect': true,
				// The notification prompt and this modal share a once-per-window flag. The
				// notification fires at activation for a workspace with dependency files and
				// would claim the flag first, hiding the modal.
				'python.createEnvironment.trigger': 'off',
			});
			await use();
		},
		{ scope: 'worker' }
	],
});

test.use({
	suiteId: __filename
});

test.describe('Sessions: Externally managed Python prompt', {
	tag: [tags.SESSIONS, tags.INTERPRETER, tags.MODAL]
}, () => {
	// Linux only: Ubuntu 24 CI guarantees a /usr/bin/python3 that carries the PEP 668 marker.
	test.skip(process.platform !== 'linux', 'Requires a distro Python with a PEP 668 marker');

	// The window shares one extension host across every test in this file (worker-scoped
	// app), and the modal claims the once-per-window flag for every answer except an
	// unanswered dismiss (Escape/close). Reloading resets that flag, and deleting sessions
	// keeps each test's session-count assertions independent of what earlier tests started.
	test.beforeEach(async function ({ app }) {
		await app.workbench.hotKeys.reloadWindow(true);
		await app.workbench.sessions.deleteAll();
	});

	// Read lazily. This describe body is evaluated during collection on every platform, and
	// shelling out to a /usr/bin/python3 that may not exist would fail collection outright
	// rather than skipping cleanly. Only the tests below, which the skip above already
	// gates, ever call these.
	let cachedVersion: string | undefined;
	function systemPythonVersion(): string {
		cachedVersion ??= execSync('/usr/bin/python3 -V').toString().trim().replace('Python ', '');
		return cachedVersion;
	}
	function systemPythonLabel(): string {
		return `Python ${systemPythonVersion()} (System)`;
	}

	async function pickSystemPython(app: Application): Promise<void> {
		const { sessions, quickInput } = app.workbench;
		await sessions.openStartNewSessionQuickPick();
		await quickInput.waitForInterpreterDiscoveryToComplete();
		await quickInput.type(`Python ${systemPythonVersion()}`);
		await quickInput.selectQuickInputElementContaining(systemPythonLabel());
	}

	test('Prompts with all three buttons when a system Python is picked', async function ({ app }) {
		const { dynamicModals } = app.workbench;

		await pickSystemPython(app);

		await dynamicModals.expectToBeVisible('Create a virtual environment for this workspace?');
		await dynamicModals.expectMessageToContain(`Python ${systemPythonVersion()} is managed by`);
		await dynamicModals.expectButtonsToBeVisible(['Create Environment', 'Not Now', 'Never for This Interpreter']);

		await dynamicModals.clickButton('Not Now');
	});

	test('Not Now starts the session', async function ({ app }) {
		const { dynamicModals, sessions } = app.workbench;

		await pickSystemPython(app);
		await dynamicModals.expectToBeVisible();
		await dynamicModals.clickButton('Not Now');

		await sessions.expectSessionCountToBe(1);
		await sessions.expectAllSessionsToBeReady();
	});

	test('Escape starts no session', async function ({ app }) {
		const { dynamicModals, sessions } = app.workbench;

		await pickSystemPython(app);
		await dynamicModals.expectToBeVisible();
		await dynamicModals.pressEscape();
		await dynamicModals.expectNotToBeVisible();

		await sessions.expectSessionCountToBe(0);
	});

	test('The close button starts no session', async function ({ app }) {
		const { dynamicModals, sessions } = app.workbench;

		await pickSystemPython(app);
		await dynamicModals.expectToBeVisible();
		await dynamicModals.clickCloseButton();
		await dynamicModals.expectNotToBeVisible();

		await sessions.expectSessionCountToBe(0);
	});

	// Ordered last: the suppression list lives in globalState and is not reset between tests.
	test('Never for This Interpreter starts the session and stops prompting', async function ({ app }) {
		const { dynamicModals, sessions } = app.workbench;

		await pickSystemPython(app);
		await dynamicModals.expectToBeVisible();
		await dynamicModals.clickButton('Never for This Interpreter');
		await sessions.expectSessionCountToBe(1);
		await sessions.expectAllSessionsToBeReady();

		// Reload to reset the once-per-window flag, then clear sessions so the second pick
		// has to start one of its own. The session start is blocked behind the prompt, so
		// waiting for the new session to be ready proves the prompt opportunity came and
		// went; a bare no-modal assertion would pass before the modal had time to render.
		await app.workbench.hotKeys.reloadWindow(true);
		await sessions.deleteAll();
		await pickSystemPython(app);

		await sessions.expectSessionCountToBe(1);
		await sessions.expectAllSessionsToBeReady();
		await dynamicModals.expectNotToBeVisible();
	});
});
