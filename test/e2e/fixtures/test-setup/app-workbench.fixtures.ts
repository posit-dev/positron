/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import * as fs from 'fs';
import * as os from 'os';
import { Application, createApp } from '../../infra';
import { AppFixtureOptions } from './app.fixtures';
import { setFixtureScreenshot, moveAndOverwrite } from './shared-utils';
import { ROOT_PATH } from './constants';

/**
 * Posit Workbench fixture (Docker on port 8787)
 * Projects: e2e-workbench
 */
export function WorkbenchAppFixture() {
	return async (fixtureOptions: AppFixtureOptions, use: (arg0: Application) => Promise<void>) => {
		const { options, logsPath, logger, workerInfo } = fixtureOptions;

		// For workbench, we don't copy files locally - they go directly to Docker
		const serverUserDataDir = join(os.homedir(), '.positron-e2e-test');
		const userDir = join(serverUserDataDir, 'User');
		await mkdir(userDir, { recursive: true });

		const app = createApp(options);

		try {
			// Copy settings and workspace to the Docker container
			await copyWorkbenchSettings(app);
			await app.connectToExternalServer();

			// Workbench: Login to Posit Workbench
			await app.positWorkbench.auth.signIn();
			await app.positWorkbench.dashboard.expectHeaderToBeVisible();
			await app.positWorkbench.dashboard.openSession('qa-example-content');

			// Wait for Positron to be ready
			await app.code.driver.page.waitForSelector('.monaco-workbench', { timeout: 60000 });
			await app.workbench.sessions.deleteAll();
			await app.workbench.hotKeys.closeAllEditors();

			await use(app);

			// Cleanup session so we don't leave a rogue session behind
			await app.positWorkbench.dashboard.goTo();
			await app.positWorkbench.dashboard.quitSession('qa-example-content');
		} catch (error) {
			// capture a screenshot on failure
			const screenshotPath = path.join(logsPath, 'external-server-failure.png');
			try {
				const page = app.code?.driver?.page;
				if (page) {
					const screenshot = await page.screenshot({ path: screenshotPath });
					setFixtureScreenshot(screenshot);
				}
			} catch {
				// ignore
			}

			throw error; // re-throw the error to ensure test failure
		} finally {
			await app.stopExternalServer();

			// rename the temp logs dir to the spec name (if available)
			await moveAndOverwrite(logger, logsPath, workerInfo);
		}
	};
}

async function copyWorkbenchSettings(app: Application) {
	// This function is specifically for Posit Workbench (port 8787) running in Docker
	// Use Docker to copy configuration files and workspace to the container
	const fixturesDir = path.join(ROOT_PATH, 'test/e2e/fixtures');
	const userSettingsFile = path.join(fixturesDir, 'settings.json');
	const keybindingsFile = path.join(fixturesDir, 'keybindings.json');

	try {
		console.log('✓ Copying settings to workbench...');
		const { execSync } = require('child_process');

		// 1. Copy workspace (qa-example-content) to container
		const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
		const WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');

		// Copy workspace to container
		try {
			// First create the target directory
			const createWorkspaceDirCommand = 'docker exec test mkdir -p /home/user1/qa-example-content';
			execSync(createWorkspaceDirCommand, { stdio: 'inherit' });

			// Copy the contents of qa-example-content (not the folder itself)
			const workspaceCommand = `docker cp ${WORKSPACE_PATH}/. test:/home/user1/qa-example-content/`;
			execSync(workspaceCommand, { stdio: 'inherit' });
		} catch (error) {
			console.error('Failed to copy workspace to container:', error);
			throw error;
		}

		// 2. Merge settings with Docker-specific settings
		const mergedSettings = {
			...JSON.parse(fs.readFileSync(userSettingsFile, 'utf8')),
			...JSON.parse(fs.readFileSync(path.join(fixturesDir, 'settingsDocker.json'), 'utf8')),
		};

		// Create necessary directories in the container first
		try {
			const createDirCommand = 'docker exec test mkdir -p /home/user1/.positron-server/User/';
			execSync(createDirCommand, { stdio: 'inherit' });

			// Fix ownership of the entire directory hierarchy immediately after creation
			// This ensures user1 can access the parent directory
			const fixDirOwnershipCommand = 'docker exec test chown -R user1:user1g /home/user1/.positron-server/';
			execSync(fixDirOwnershipCommand, { stdio: 'inherit' });
		} catch (error) {
			console.error('Failed to create directories in container:', error);
			throw error;
		}

		// Create a temporary merged settings file
		const tempSettingsFile = path.join(fixturesDir, 'settings-merged.json');
		fs.writeFileSync(tempSettingsFile, JSON.stringify(mergedSettings, null, 2));

		// Copy merged settings.json to container
		try {
			const settingsCommand = `docker cp ${tempSettingsFile} test:/home/user1/.positron-server/User/settings.json`;
			execSync(settingsCommand, { stdio: 'inherit' });
		} catch (error) {
			console.error('Failed to copy settings.json to container:', error);
			throw error;
		}

		// Clean up temporary file
		fs.unlinkSync(tempSettingsFile);

		// Copy keybindings.json to container
		try {
			const keybindingsCommand = `docker cp ${keybindingsFile} test:/home/user1/.positron-server/User/keybindings.json`;
			execSync(keybindingsCommand, { stdio: 'inherit' });
		} catch (error) {
			console.error('Failed to copy keybindings.json to container:', error);
			throw error;
		}

		// 3. Fix file permissions so user1 can access everything
		try {
			// Fix ownership of copied files (directory ownership was already fixed above)
			const chownSettingsCommand = 'docker exec test chown -R user1:user1g /home/user1/.positron-server/User/';
			execSync(chownSettingsCommand, { stdio: 'inherit' });
		} catch (error) {
			console.error('Failed to change ownership of settings directory:', error);
			throw error;
		}

		try {
			const chownWorkspaceCommand = 'docker exec test chown -R user1 /home/user1/qa-example-content/';
			execSync(chownWorkspaceCommand, { stdio: 'inherit' });
		} catch (error) {
			console.error('Failed to change ownership of workspace directory:', error);
			throw error;
		}

		// Also ensure the files are writable
		try {
			const chmodSettingsCommand = 'docker exec test chmod -R 755 /home/user1/.positron-server/User/';
			execSync(chmodSettingsCommand, { stdio: 'inherit' });
		} catch (error) {
			console.error('Failed to change permissions of settings directory:', error);
			throw error;
		}

		try {
			const chmodWorkspaceCommand = 'docker exec test chmod -R 755 /home/user1/qa-example-content/';
			execSync(chmodWorkspaceCommand, { stdio: 'inherit' });
		} catch (error) {
			console.error('Failed to change permissions of workspace directory:', error);
			throw error;
		}

	} catch (error) {
		console.error('Error copying workspace and settings to Posit Workbench container:', error);
		throw error;
	}
}
