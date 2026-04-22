/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { join } from 'path';
import { Application, createApp } from '../../infra';
import { AppFixtureOptions } from './app.fixtures';
import { runDockerCommand, copyUserSettingsToContainer, copyKeyBindingsToContainer, RunResult } from './docker-utils';

export { RunResult };

/**
 * Jupyter Positron session (Docker on port 8888)
 * Projects: e2e-jupyter
 */

export async function JupyterApp(
	fixtureOptions: AppFixtureOptions
): Promise<{ app: Application; start: () => Promise<void>; stop: () => Promise<void> }> {
	const { options } = fixtureOptions;
	const JUPYTER_WORKSPACE_PATH = '/home/jupyter-admin/qa-example-content/';

	const app = createApp({ ...options, workspacePath: JUPYTER_WORKSPACE_PATH });

	const start = async () => {
		await app.connectToExternalServer();

		// Jupyter: Login to JupyterHub (this creates the jupyter-admin user)
		await app.positJupyter.auth.signIn();

		// Now that the user exists, setup the environment
		await setupJupyterEnvironment();

		// Open Positron from JupyterLab
		await app.positJupyter.lab.openPositron();

		// Wait for Positron to be ready
		await app.workbench.sessions.expectNoStartUpMessaging();
		await app.workbench.sessions.deleteAll();

		await app.workbench.hotKeys.closeAllEditors();
	};

	const stop = async () => {
		// Exit Jupyter session
		try {
			// Navigate to control panel
			await app.positJupyter.lab.goToControlPanel();

			// Stop the server
			await app.positJupyter.lab.stopServer();

			// Start the server again (for next test run)
			await app.positJupyter.lab.startServer();

			// Log out
			await app.positJupyter.lab.logout();
		} catch (error) {
			console.warn('Failed to stop Jupyter session:', error);
		}

		await app.stopExternalServer();
	}

	return { app, start, stop };
}

/**
 * Setup the complete Jupyter environment: Docker container, configuration, and permissions
 * NOTE: This must be called AFTER login, as login creates the jupyter-admin user
 */
async function setupJupyterEnvironment(): Promise<void> {
	const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
	const DEFAULT_WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');
	const JUPYTER_WORKSPACE_PATH = '/home/jupyter-admin/qa-example-content/';
	const JUPYTER_USER_SERVER_DIR = '/home/jupyter-admin/.positron-server/';
	const JUPYTER_USER_DATA_DIR = `${JUPYTER_USER_SERVER_DIR}data/User/`;

	// Create workspace and settings directories
	await runDockerCommand(`docker exec jupyter-test mkdir -p ${JUPYTER_WORKSPACE_PATH}`, 'Create workspace directory');
	await runDockerCommand(`docker exec jupyter-test mkdir -p ${JUPYTER_USER_DATA_DIR}`, 'Create user settings directory');

	const src = DEFAULT_WORKSPACE_PATH;
	const dst = JUPYTER_WORKSPACE_PATH;

	const isMac = process.platform === 'darwin';
	const tarFromHost =
		isMac
			// macOS (bsdtar): skip AppleDouble/attrs + .git, .DS_Store
			? `export COPYFILE_DISABLE=1; tar -C "${src}" -cf - --exclude=".git" --exclude=".DS_Store" --exclude="._*" .`
			// Linux (GNU tar): just exclude .git
			: `tar -C "${src}" -cf - --exclude=".git" .`;

	await runDockerCommand(
		[
			`docker exec jupyter-test mkdir -p "${dst}"`,
			`${tarFromHost} | docker exec -i jupyter-test tar -C "${dst}" -xpf -`
		].join(' && '),
		'Copy workspace to container (excluding .git)'
	);


	// Copy settings to container
	await copyUserSettingsToContainer(
		'jupyter-test',
		'/home/jupyter-admin/.positron-server/data/User/',
		['settings.json', 'settingsDocker.json']
	);
	await copyKeyBindingsToContainer('jupyter-test', '/home/jupyter-admin/.positron-server/data/User/');

	// Fix permissions
	await runDockerCommand(`docker exec jupyter-test chown -R jupyter-admin:jupyter-admin ${JUPYTER_USER_SERVER_DIR}`, 'Set ownership of server directory');
	await runDockerCommand(`docker exec jupyter-test chown -R jupyter-admin ${JUPYTER_WORKSPACE_PATH}`, 'Set ownership of workspace directory');
	await runDockerCommand(`docker exec jupyter-test chmod -R 755 ${JUPYTER_USER_DATA_DIR}`, 'Set permissions of settings directory');
	await runDockerCommand(`docker exec jupyter-test chmod -R 755 ${JUPYTER_WORKSPACE_PATH}`, 'Set permissions of workspace directory');
}
