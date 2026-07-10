/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PermissionPayload } from '../../pages/connect.js';
import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

let userId: string;
let pythonVersion: string;
// Resolved in beforeAll: the password used both to set user1's PAM password in
// the connect container and to sign in at the end. Falls back to a default so
// the local (e2e-connect) run needs no env setup; the Workbench run keeps using
// POSIT_WORKBENCH_PASSWORD.
let connectUserPassword: string;
const connectServer = 'http://connect:3939';

test.describe('Publisher - Shiny', { tag: [tags.WORKBENCH, tags.CONNECT, tags.PUBLISHER] }, () => {

	test.beforeAll('Get connect API key', async function ({ app, runDockerCommand, hotKeys }) {

		// Local electron run (connect-local stack) vs the Workbench web run.
		const isLocal = test.info().project.name === 'e2e-connect';

		connectUserPassword = process.env.POSIT_WORKBENCH_PASSWORD || 'testpassword';

		// Skip the suite when Connect isn't up (e.g. the full local suite is run
		// without the connect-local stack started).
		test.skip(!(await app.workbench.positConnect.isReachable()), 'Posit Connect is not reachable at http://localhost:3939');

		// Resolve the publisher API key: env -> local token file -> Workbench volume.
		const connectApiKey = await app.workbench.positConnect.resolveApiKey(isLocal ? undefined : runDockerCommand);
		app.workbench.positConnect.setConnectApiKey(connectApiKey);

		if (!(await app.workbench.positConnect.isApiKeyValid())) {
			throw new Error('Connect API key did not authenticate against http://localhost:3939');
		}

		// Local self-heal: if the connect-data volume was wiped and re-bootstrapped,
		// a saved publisher credential holds a stale key -- clear it so the publish
		// flow re-enters the fresh key.
		if (isLocal && app.workbench.positConnect.recordKeyAndDetectRotation(connectApiKey)) {
			await app.workbench.publisher.clearSavedCredentials();
		}

		// Ensure the PAM/system user1 exists with the current password on EVERY
		// run. The system account lives in the connect container filesystem (reset
		// when the container is recreated), while the Connect DB user record lives
		// in the persistent connect-data volume -- so gating this on the Connect
		// user existing leaves the PAM password unset/stale and sign-in fails.
		// groupadd/useradd are guarded so they're idempotent; chpasswd always runs.
		await runDockerCommand(`docker exec connect bash -c 'getent group user1g >/dev/null 2>&1 || sudo groupadd -g 1100 user1g'`, 'Ensure group user1g');
		await runDockerCommand(`docker exec connect bash -c 'id -u user1 >/dev/null 2>&1 || sudo useradd --create-home --shell /bin/bash --home-dir /home/user1 -u 1100 -g 1100 user1'`, 'Ensure user user1');
		await runDockerCommand(`docker exec connect bash -c 'echo "user1":"${connectUserPassword}" | sudo chpasswd'`, 'Set password for user1');

		const user1Present = await app.workbench.positConnect.getUserId('user1');
		if (!user1Present) {
			userId = await app.workbench.positConnect.createUser();
		} else {
			userId = user1Present;
		}

		const versions = await app.workbench.positConnect.getPythonVersions();
		pythonVersion = versions[0];

		await hotKeys.stackedLayout();

	});

	test('Verify Publisher functionality with Shiny app deployment', async function ({ app, page, openFile, hotKeys }) {

		await test.step('Open file', async () => {
			await openFile('workspaces/shiny-py-example/app.py');
		});

		await test.step('Click on Publish button', async () => {
			await app.workbench.editorActionBar.clickButton('Deploy with Posit Publisher');
		});

		await test.step('Enter title for application through quick-input', async () => {
			await app.workbench.quickInput.waitForQuickInputOpened();
			await app.workbench.quickInput.type('shiny-py-example');
			await page.keyboard.press('Enter');
		});

		const existingPresent = await app.workbench.publisher.hasSavedCredential(page, 'connect-container');

		if (existingPresent) {
			await test.step('Use saved credential', async () => {
				await app.workbench.publisher.useSavedCredential();
			});
		} else {
			// Make sure to delete stored credentials by accessing Keychain Access --> Login --> Search for `posit` --> Remove `Posit Publisher Safe Storage`
			await test.step('Enter Connect server and API key', async () => {
				await app.workbench.publisher.enterConnectCredentials(page, connectServer, app.workbench.positConnect.getConnectApiKey());
			});

			await test.step('Unique name for credential (Connect Server and API key)', async () => {
				await app.workbench.publisher.saveCredentialName(page, 'connect-container', connectServer);
			});
		}

		const { innerFrame } = app.workbench.publisher.getPublisherFrames(page);

		await test.step('Add files to deployment file (after app.py) and save', async () => {
			await app.workbench.publisher.selectDeploymentFiles(innerFrame, ['shared.py', 'styles.css', 'tips.csv']);
		});

		const deployButton = app.workbench.publisher.getDeployButton(innerFrame);

		await test.step('Expect Deploy Your Project button to appear', async () => {
			await expect(deployButton).toBeVisible();
		});

		await hotKeys.minimizeBottomPanel();

		await test.step('Ensure toml file is ready for update - flake workaround', async () => {
			await expect(async () => {
				try {
					// is tips.csv in the toml file?
					const editorContainer = app.code.driver.currentPage.locator('[id="workbench.parts.editor"]');
					const dynamicTomlLineRegex = 'tips.csv';
					const targetLine = editorContainer.locator('.view-line').filter({ hasText: dynamicTomlLineRegex });
					await expect(targetLine).toBeVisible({ timeout: 10000 });
				} catch (e) {
					// reload the toml file
					const filenames = await app.workbench.editor.getMonacoFilenames();
					await hotKeys.closeAllEditors();
					const file = `workspaces/shiny-py-example/.posit/publish/${filenames.find(f => f.startsWith('shiny-py-example'))}`;
					console.log(`Retrying to open file ${file} in editor`);
					await openFile(file);
					await hotKeys.stackedLayout();
					await hotKeys.minimizeBottomPanel();
					await hotKeys.publishDocument();
					throw e;
				}
			}).toPass({ timeout: 60000 });
		});

		await test.step('Update toml file', async () => {
			await app.workbench.positConnect.setPythonVersion(pythonVersion);

			await hotKeys.save();

			await expect(app.workbench.topActionBar.saveAllButton).not.toBeEnabled({ timeout: 10000 });
		});

		let appGuid;
		await test.step('Deploy, await completion and get appGuid', async () => {
			await deployButton.click({ timeout: 5000 });

			await expect(app.code.driver.currentPage.locator('text=Deployment was successful').first()).toBeVisible({ timeout: 200000 });

			await hotKeys.closeSecondarySidebar();

			await hotKeys.restoreBottomPanel();

			await app.code.driver.currentPage.locator('.monaco-action-bar .action-label', { hasText: 'Publisher' }).click({ timeout: 60000 });

			const deployedLocator = app.code.driver.currentPage.locator('.monaco-tl-row .monaco-highlighted-label', { hasText: 'Successfully deployed at' });

			const deploymentText = await deployedLocator.textContent();

			appGuid = app.workbench.publisher.extractGuid(deploymentText || '');
		});

		await test.step('Grant permission to connect user', async () => {
			const payload: PermissionPayload = {
				principal_guid: userId,
				principal_type: 'user',
				role: 'viewer',
			};

			await app.workbench.positConnect.setContentPermission(
				appGuid!,
				payload,
			);
		});

		await test.step('Ensure connect user can access content', async () => {
			await app.code.driver.currentPage.goto('http://localhost:3939');

			await app.code.driver.currentPage.locator('[data-automation="signin"]').click();

			await app.code.driver.currentPage.fill('input[name="username"]', 'user1');
			await app.code.driver.currentPage.fill('input[name="password"]', connectUserPassword);
			await app.code.driver.currentPage.locator('[data-automation="login-panel-submit"]').click();

			await app.code.driver.currentPage.locator('[data-automation="content-table__row__display-name"]').first().click();

			const headerLocator = app.code.driver.currentPage.frameLocator('#contentIFrame').locator('h1');
			await expect(headerLocator).toHaveText('Restaurant tipping', { timeout: 20000 });
		});

	});
});
