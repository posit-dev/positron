/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { join } from 'path';
import { Application, createApp } from '../../infra';
import { AppFixtureOptions } from './app.fixtures';
import { runDockerCommand, copyUserSettingsToContainer, copyKeyBindingsToContainer, dockerSettingsOverrides, RunResult } from './docker-utils';

export { RunResult };

/**
 * Workbench Positron session (Docker on port 8787)
 * Projects: e2e-workbench
 */

export async function WorkbenchApp(
	fixtureOptions: AppFixtureOptions
): Promise<{ app: Application; start: () => Promise<void>; stop: () => Promise<void> }> {
	const { options, managedCredentials, enableDataConnections } = fixtureOptions;
	const { workspacePath } = await setupWorkbenchEnvironment(managedCredentials, enableDataConnections);

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
				`docker exec test bash -c "cp -r /home/user1/qa-example-content /home/rstudio-ide-test/ && chown -R rstudio-ide-test /home/rstudio-ide-test/qa-example-content"`,
				'Copy qa-example-content into rstudio-ide-test home (Azure JIT user)'
			);
			await app.positWorkbench.dashboard.openWorkspaceFolder('qa-example-content');
		}

		await app.workbench.sessions.expectNoStartUpMessaging();
		await app.workbench.sessions.deleteAll();

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
async function setupWorkbenchEnvironment(managedCredentials?: 'snowflake' | 'databricks' | 'azure', enableDataConnections?: boolean): Promise<{ workspacePath: string; userDataDir: string }> {
	if (managedCredentials) {
		console.log(`Workbench fixture: expecting managed credential "${managedCredentials}" to be provisioned in the container`);
	}
	const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
	const DEFAULT_WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');
	const WORKBENCH_WORKSPACE_PATH = '/home/user1/qa-example-content/'
	const WORKBENCH_USER_SERVER_DIR = '/home/user1/.positron-server/';
	const WORKBENCH_USER_DATA_DIR = `${WORKBENCH_USER_SERVER_DIR}User/`;

	// Create workspace and settings directories
	await runDockerCommand(`docker exec test mkdir -p ${WORKBENCH_WORKSPACE_PATH}`, 'Create workspace directory');
	await runDockerCommand(`docker exec test mkdir -p ${WORKBENCH_USER_DATA_DIR}`, 'Create user settings directory');

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
			`docker exec test mkdir -p "${dst}"`,
			`${tarFromHost} | docker exec -i test tar -C "${dst}" -xpf -`
		].join(' && '),
		'Copy workspace to container (excluding .git)'
	);


	// Copy settings to container
	await copyUserSettingsToContainer(
		'test',
		'/home/user1/.positron-server/User/',
		['settings.json', 'settingsDocker.json', 'settingsWorkbench.json'],
		dockerSettingsOverrides({ enableDataConnections })
	);
	await copyKeyBindingsToContainer('test', '/home/user1/.positron-server/User/');

	// Fix permissions
	await runDockerCommand(`docker exec test chown -R user1:user1g ${WORKBENCH_USER_SERVER_DIR}`, 'Set ownership of server directory');
	await runDockerCommand(`docker exec test chown -R user1 ${WORKBENCH_WORKSPACE_PATH}`, 'Set ownership of workspace directory');
	await runDockerCommand(`docker exec test chmod -R 755 ${WORKBENCH_USER_DATA_DIR}`, 'Set permissions of settings directory');
	await runDockerCommand(`docker exec test chmod -R 755 ${WORKBENCH_WORKSPACE_PATH}`, 'Set permissions of workspace directory');

	return { workspacePath: WORKBENCH_WORKSPACE_PATH, userDataDir: WORKBENCH_USER_DATA_DIR };
}

