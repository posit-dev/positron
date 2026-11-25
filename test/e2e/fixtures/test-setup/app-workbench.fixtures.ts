/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { Application, createApp } from '../../infra';
import { provisionTestFiles } from '../../infra/test-runner';
import { AppFixtureOptions } from './app.fixtures';
import { AWS_MANAGED_ROLE_NAME } from '../../pages/workbench/dashboard.page';
import { runDockerCommand, copyUserSettingsToContainer, copyKeyBindingsToContainer, dockerSettingsOverrides, enablePositAIProviderInContainer, restorePositAIProviderInContainer, RunResult } from './docker-utils';

export { RunResult };

const CONTAINER_NAME = 'test';
const OPENID_USER = 'rstudio-ide-test';
const AWS_MANAGED_ROLE_ARN = `arn:aws:iam::749683154838:role/${AWS_MANAGED_ROLE_NAME}`;

/**
 * Workbench Positron session (Docker on port 8787)
 * Projects: e2e-workbench
 */

export async function WorkbenchApp(
	fixtureOptions: AppFixtureOptions
): Promise<{ app: Application; start: () => Promise<void>; stop: () => Promise<void> }> {
	const { options, managedCredentials, useLegacyNotebookEditor, enableDataConnections, enableFoundryAssistant, enablePositAIProvider, extraSettings } = fixtureOptions;
	const { workspacePath } = await setupWorkbenchEnvironment(managedCredentials, useLegacyNotebookEditor, enableDataConnections, enableFoundryAssistant, extraSettings);

	// Seed the provider catalog before the session starts so the server reads it on
	// startup, rather than racing the file watcher's debounce or forcing a reload.
	if (enablePositAIProvider) {
		await enablePositAIProviderInContainer(CONTAINER_NAME);
	}

	const app = createApp({ ...options, workspacePath });
	// AWS managed credentials need OpenID sign-in, so that shard shares the Azure identity.
	const signsInWithOpenId = managedCredentials === 'azure' || managedCredentials === 'aws';

	const start = async () => {
		await app.connectToExternalServer();

		// Workbench: Login to Posit Workbench. The Azure shard signs in via OIDC against the
		// rstudio-ide-test service account in Azure AD; everything else uses local user1 creds.
		if (signsInWithOpenId) {
			await app.positWorkbench.auth.signInWithAzure();
		} else {
			await app.positWorkbench.auth.signIn();
		}
		await app.positWorkbench.dashboard.expectHeaderToBeVisible();

		if (managedCredentials === 'aws') {
			// The role can only be assigned once the first sign-in has registered the user.
			await runDockerCommand(
				`docker exec ${CONTAINER_NAME} sudo rstudio-server set-aws-role-arns ${OPENID_USER} ${AWS_MANAGED_ROLE_ARN}`,
				'Assign the AWS role to the OpenID user'
			);
			// The dashboard loaded before the assignment and does not list the role until reloaded.
			await app.code.driver.currentPage.reload();
			await app.positWorkbench.dashboard.expectHeaderToBeVisible();
		}

		// Get the browser context for OAuth flows
		const context = app.code.driver.currentPage.context();
		const newProjectCreated = await app.positWorkbench.dashboard.openSession('test-files', context, managedCredentials);

		// Wait for Positron to be ready
		await app.code.driver.currentPage.waitForSelector('.monaco-workbench', { timeout: 60000 });

		if (managedCredentials === 'aws') {
			// The Redshift driver fails if it connects before Workbench writes the token.
			await expect.poll(async () => {
				const result = await runDockerCommand(
					`docker exec ${CONTAINER_NAME} bash -c "sudo test -s /tmp/${OPENID_USER}/posit-workbench/id_token && echo ready || echo missing"`,
					'Check for the AWS web identity token'
				);
				return result.stdout.trim();
			}, { timeout: 30000 }).toBe('ready');
		}

		if (signsInWithOpenId) {
			// The Azure session runs as the JIT user rstudio-ide-test, which reads
			// settings from its own home dir (created by PAM on session launch), not
			// user1's. Provision the same settings there so the workspace opens trusted
			// (security.workspace.trust.enabled=false) and provider settings like the
			// Foundry endpoint reach the session.
			await provisionUserSettings(
				'/home/rstudio-ide-test/.positron-server/',
				'rstudio-ide-test',
				dockerSettingsOverrides({ useLegacyNotebookEditor, enableDataConnections, enableFoundryAssistant, extraSettings })
			);
			// createNewProject skipped the Open Folder step: the JIT user has no test-files
			// at launch time. Copy it in now that PAM created the home dir and open it like
			// the other shards do (the reload also applies the settings written above).
			// A relaunched project (e.g. on a retry) already opens in the folder, so the
			// Explorer's "Open Folder" button does not exist on that path.
			if (newProjectCreated) {
				await runDockerCommand(
					`docker exec ${CONTAINER_NAME} bash -c "mkdir -p /home/rstudio-ide-test/test-files && cp -r /home/user1/test-files/. /home/rstudio-ide-test/test-files/ && chown -R rstudio-ide-test /home/rstudio-ide-test/test-files"`,
					'Copy test-files into rstudio-ide-test home (Azure JIT user)'
				);
				await app.positWorkbench.dashboard.openWorkspaceFolder('test-files');
			}
		}
		// The Azure shard runs as a freshly-provisioned JIT user (rstudio-ide-test)
		// whose interpreter discovery / runtime startup does not settle the way
		// user1's warm environment does -- it sits on "Discovering interpreters"
		// well past the 90s gate. These credential/assistant tests don't use a
		// Python/R runtime session, so skip the session-readiness gate for this
		// shard rather than block the fixture on a signal we never consume.
		if (!signsInWithOpenId) {
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
			await app.positWorkbench.dashboard.quitSession('test-files');
		} catch (error) {
			console.warn('Failed to quit workbench session:', error);
		}

		// Put the catalog back for the other suites sharing this container.
		//
		// Deliberately not rethrown. The app fixture awaits stop() from a `finally`
		// that is unwinding from the test's own error, so throwing here would replace
		// that error and hide the actual failure. Logged as an error rather than a
		// warning because the consequence outlives this worker: the container is
		// shared, so a missed restore leaves Posit AI enabled for later suites. It
		// does not become permanent -- the backup is left in place for the next
		// session's setup to restore from (see enablePositAIProviderInContainer).
		if (enablePositAIProvider) {
			try {
				await restorePositAIProviderInContainer(CONTAINER_NAME);
			} catch (error) {
				console.error(
					'Failed to restore the provider catalog; Posit AI may be left enabled for later suites in this container:',
					error
				);
			}
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
async function setupWorkbenchEnvironment(managedCredentials?: 'snowflake' | 'databricks' | 'azure' | 'aws', useLegacyNotebookEditor?: boolean, enableDataConnections?: boolean, enableFoundryAssistant?: boolean, extraSettings?: Record<string, unknown>): Promise<{ workspacePath: string; userDataDir: string }> {
	if (managedCredentials) {
		console.log(`Workbench fixture: expecting managed credential "${managedCredentials}" to be provisioned in the container`);
	}
	const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
	const DEFAULT_WORKSPACE_PATH = join(TEST_DATA_PATH, 'test-files');
	const WORKBENCH_WORKSPACE_PATH = '/home/user1/test-files/'
	const WORKBENCH_USER_SERVER_DIR = '/home/user1/.positron-server/';
	const WORKBENCH_USER_DATA_DIR = `${WORKBENCH_USER_SERVER_DIR}User/`;

	// Create workspace directory (the settings directory is created by provisionUserSettings).
	await runDockerCommand(`docker exec ${CONTAINER_NAME} mkdir -p ${WORKBENCH_WORKSPACE_PATH}`, 'Create workspace directory');

	// The Playwright VS Code extension's "play" button does not run globalSetup, which is what
	// normally provisions test-files into the temp workspace. When that step was skipped the
	// tar below fails with "could not chdir to <workspace>". Stage it on demand from the local
	// test-files directory so single-test runs from the extension behave like the CLI.
	if (!fs.existsSync(DEFAULT_WORKSPACE_PATH)) {
		provisionTestFiles(DEFAULT_WORKSPACE_PATH);
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
		dockerSettingsOverrides({ useLegacyNotebookEditor, enableDataConnections, enableFoundryAssistant, extraSettings })
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
	// The settings page object edits this file, which is the one the server reads.
	process.env.PLAYWRIGHT_CONTAINER_USER_SETTINGS = `${CONTAINER_NAME}:${userDataDir}settings.json`;
	await copyUserSettingsToContainer(
		CONTAINER_NAME,
		userDataDir,
		['settings.json', 'settingsDocker.json', 'settingsWorkbench.json'],
		settingsOverrides
	);
	await copyKeyBindingsToContainer(CONTAINER_NAME, userDataDir);
	// Not recursive: a running session creates and deletes files here, which fails a recursive walk.
	const written = `${serverDir} ${userDataDir} ${userDataDir}settings.json ${userDataDir}keybindings.json`;
	await runDockerCommand(`docker exec ${CONTAINER_NAME} chown ${owner} ${written}`, 'Set ownership of the settings files');
	await runDockerCommand(`docker exec ${CONTAINER_NAME} chmod 755 ${written}`, 'Set permissions of the settings files');
}

