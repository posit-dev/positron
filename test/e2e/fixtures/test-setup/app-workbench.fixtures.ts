/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { Application, createApp } from '../../infra';
import { cloneTestRepo } from '../../infra/test-runner';
import { AppFixtureOptions } from './app.fixtures';
import { runDockerCommand, copyUserSettingsToContainer, copyKeyBindingsToContainer, dockerSettingsOverrides, RunResult } from './docker-utils';

export { RunResult };

const CONTAINER_NAME = 'test';

/**
 * Workbench Positron session (Docker on port 8787)
 * Projects: e2e-workbench
 */

export async function WorkbenchApp(
	fixtureOptions: AppFixtureOptions
): Promise<{ app: Application; start: () => Promise<void>; stop: () => Promise<void> }> {
	const { options, managedCredentials, useLegacyNotebookEditor, enableDataConnections, enableFoundryAssistant } = fixtureOptions;
	const { workspacePath } = await setupWorkbenchEnvironment(managedCredentials, useLegacyNotebookEditor, enableDataConnections, enableFoundryAssistant);

	const app = createApp({ ...options, workspacePath });

	const start = async () => {
		await app.connectToExternalServer();

		// Workbench: Login to Posit Workbench. The Azure shard signs in via OIDC against the
		// rstudio-ide-test service account in Azure AD; everything else uses local user1 creds.
		if (managedCredentials === 'azure') {
			await app.positWorkbench.auth.signInWithAzure();
		} else {
			await app.positWorkbench.auth.signIn();
		}
		await app.positWorkbench.dashboard.expectHeaderToBeVisible();

		// Get the browser context for OAuth flows
		const context = app.code.driver.currentPage.context();
		await app.positWorkbench.dashboard.openSession('qa-example-content', context, managedCredentials);

		// Wait for Positron to be ready
		await app.code.driver.currentPage.waitForSelector('.monaco-workbench', { timeout: 60000 });

		// For the Azure shard, the dashboard's createNewProject skipped the Open Folder step
		// because the JIT user (rstudio-ide-test) doesn't have qa-example-content in their home
		// dir at launch time. Now that PAM has created /home/rstudio-ide-test (triggered by the
		// session launch), copy the workspace in and open it the same way the other shards do.
		if (managedCredentials === 'azure') {
			await runDockerCommand(
				`docker exec ${CONTAINER_NAME} bash -c "cp -r /home/user1/qa-example-content /home/rstudio-ide-test/ && chown -R rstudio-ide-test /home/rstudio-ide-test/qa-example-content"`,
				'Copy qa-example-content into rstudio-ide-test home (Azure JIT user)'
			);
			// The Azure session runs as the JIT user rstudio-ide-test, which reads
			// settings from its own home dir (created by PAM on session launch), not
			// user1's. Provision the same settings there so the workspace opens trusted
			// (security.workspace.trust.enabled=false) and provider settings like the
			// Foundry endpoint reach the session. openWorkspaceFolder reloads the window
			// into the folder, so the freshly-written settings take effect.
			await provisionUserSettings(
				'/home/rstudio-ide-test/.positron-server/',
				'rstudio-ide-test',
				dockerSettingsOverrides({ useLegacyNotebookEditor, enableDataConnections, enableFoundryAssistant })
			);
			await app.positWorkbench.dashboard.openWorkspaceFolder('qa-example-content');
		}
		// The Azure shard runs as a freshly-provisioned JIT user (rstudio-ide-test)
		// whose interpreter discovery / runtime startup does not settle the way
		// user1's warm environment does -- it sits on "Discovering interpreters"
		// well past the 90s gate. These credential/assistant tests don't use a
		// Python/R runtime session, so skip the session-readiness gate for this
		// shard rather than block the fixture on a signal we never consume.
		if (managedCredentials !== 'azure') {
			// Give startup messaging a chance to appear before asserting it's gone,
			// so we don't pass instantly when this check runs ahead of the UI.
			await app.code.driver.currentPage.waitForTimeout(5000);
			await app.workbench.sessions.expectNoStartUpMessaging();
			await app.workbench.sessions.deleteAll();
		}

		await app.workbench.hotKeys.closeAllEditors();
	};

	const stop = async () => {
		// Exit Posit Workbench session
		try {
			await app.positWorkbench.dashboard.goTo();
			await app.positWorkbench.dashboard.quitSession('qa-example-content');
		} catch (error) {
			console.warn('Failed to quit workbench session:', error);
		}

		await app.stopExternalServer();
	}

	return { app, start, stop };
}

/**
 * Setup the complete Workbench environment: Docker container, configuration, and permissions.
 *
 * `managedCredentials` indicates which credential (if any) was provisioned in the container by
 * the CI install step. The actual credential setup happens in install-workbench.sh; the fixture
 * just records it here so tests/fixtures can make conditional decisions if needed.
 */
async function setupWorkbenchEnvironment(managedCredentials?: 'snowflake' | 'databricks' | 'azure', useLegacyNotebookEditor?: boolean, enableDataConnections?: boolean, enableFoundryAssistant?: boolean): Promise<{ workspacePath: string; userDataDir: string }> {
	if (managedCredentials) {
		console.log(`Workbench fixture: expecting managed credential "${managedCredentials}" to be provisioned in the container`);
	}
	const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
	const DEFAULT_WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');
	const WORKBENCH_WORKSPACE_PATH = '/home/user1/qa-example-content/'
	const WORKBENCH_USER_SERVER_DIR = '/home/user1/.positron-server/';
	const WORKBENCH_USER_DATA_DIR = `${WORKBENCH_USER_SERVER_DIR}User/`;

	// Create workspace directory (the settings directory is created by provisionUserSettings).
	await runDockerCommand(`docker exec ${CONTAINER_NAME} mkdir -p ${WORKBENCH_WORKSPACE_PATH}`, 'Create workspace directory');

	// The Playwright VS Code extension's "play" button does not run globalSetup, which is what
	// normally clones qa-example-content into the temp workspace. When that step was skipped the
	// tar below fails with "could not chdir to <workspace>". Stage it on demand from the clone
	// cache (fast, works offline) so single-test runs from the extension behave like the CLI.
	if (!fs.existsSync(DEFAULT_WORKSPACE_PATH)) {
		cloneTestRepo(DEFAULT_WORKSPACE_PATH);
	}

	const src = DEFAULT_WORKSPACE_PATH;
	const dst = WORKBENCH_WORKSPACE_PATH;

	const isMac = process.platform === 'darwin';
	const tarFromHost =
		isMac
			// macOS (bsdtar): skip AppleDouble/attrs + .git, .DS_Store
			? `export COPYFILE_DISABLE=1; tar -C "${src}" -cf - --exclude=".git" --exclude=".DS_Store" --exclude="._*" .`
			// Linux (GNU tar): just exclude .git
			: `tar -C "${src}" -cf - --exclude=".git" .`;

	await runDockerCommand(
		[
			`docker exec ${CONTAINER_NAME} mkdir -p "${dst}"`,
			`${tarFromHost} | docker exec -i ${CONTAINER_NAME} tar -C "${dst}" -xpf -`
		].join(' && '),
		'Copy workspace to container (excluding .git)'
	);


	// Provision user1's Positron server settings + keybindings.
	await provisionUserSettings(
		WORKBENCH_USER_SERVER_DIR,
		'user1:user1g',
		dockerSettingsOverrides({ useLegacyNotebookEditor, enableDataConnections, enableFoundryAssistant })
	);

	// Fix workspace permissions
	await runDockerCommand(`docker exec ${CONTAINER_NAME} chown -R user1 ${WORKBENCH_WORKSPACE_PATH}`, 'Set ownership of workspace directory');
	await runDockerCommand(`docker exec ${CONTAINER_NAME} chmod -R 755 ${WORKBENCH_WORKSPACE_PATH}`, 'Set permissions of workspace directory');

	return { workspacePath: WORKBENCH_WORKSPACE_PATH, userDataDir: WORKBENCH_USER_DATA_DIR };
}

/**
 * Provision a user's Positron server settings directory: write the merged
 * settings (base fixtures + Docker overrides) and keybindings, then fix
 * ownership/permissions so the session user can read them.
 *
 * Used for the standard `user1` account and, on the Azure shard, for the JIT
 * user (`rstudio-ide-test`) whose home dir only exists after PAM creates it on
 * session launch. The Azure session reads settings from the JIT user's home, so
 * the workspace-trust disablers and provider settings (e.g. the Foundry
 * endpoint) must be copied there too -- otherwise the session opens in
 * restricted mode with an unconfigured provider.
 *
 * @param serverDir The `.positron-server/` directory, with trailing slash.
 * @param owner The chown target (e.g. `user1:user1g` or `rstudio-ide-test`).
 * @param settingsOverrides Test-driven settings merged last over the fixtures.
 */
async function provisionUserSettings(serverDir: string, owner: string, settingsOverrides?: object): Promise<void> {
	const userDataDir = `${serverDir}User/`;
	await runDockerCommand(`docker exec ${CONTAINER_NAME} mkdir -p ${userDataDir}`, 'Create user settings directory');
	await copyUserSettingsToContainer(
		CONTAINER_NAME,
		userDataDir,
		['settings.json', 'settingsDocker.json', 'settingsWorkbench.json'],
		settingsOverrides
	);
	await copyKeyBindingsToContainer(CONTAINER_NAME, userDataDir);
	await runDockerCommand(`docker exec ${CONTAINER_NAME} chown -R ${owner} ${serverDir}`, 'Set ownership of server directory');
	await runDockerCommand(`docker exec ${CONTAINER_NAME} chmod -R 755 ${userDataDir}`, 'Set permissions of settings directory');
}

