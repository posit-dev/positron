/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { execSync } from 'child_process';
import { Application, createApp } from '../../infra';
import { AppFixtureOptions } from './app.fixtures';
import { moveAndOverwrite, captureScreenshotOnError } from './shared-utils';
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
			// Setup Docker environment and copy configuration
			await setupWorkbenchEnvironment();
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
			try {
				await app.positWorkbench.dashboard.goTo();
				await app.positWorkbench.dashboard.quitSession('qa-example-content');
			} catch (error) {
				console.warn('Failed to quit workbench session:', error);
			}
		} catch (error) {
			await captureScreenshotOnError(app, logsPath, error);
			throw error;
		} finally {
			// Final cleanup
			try {
				await app.stopExternalServer();
			} catch (error) {
				console.warn('Failed to stop external server:', error);
			}

			// Rename the temp logs dir to the spec name (if available)
			await moveAndOverwrite(logger, logsPath, workerInfo);
		}
	};
}

/**
 * Setup the complete Workbench environment: Docker container, configuration, and permissions
 */
async function setupWorkbenchEnvironment(): Promise<void> {
	// Create directories and set up Docker environment
	await runDockerCommand('docker exec test mkdir -p /home/user1/.positron-server/User/', 'Create settings directory');
	await runDockerCommand('docker exec test mkdir -p /home/user1/qa-example-content/', 'Create workspace directory');

	// Copy workspace to container
	const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
	const WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');
	await runDockerCommand(`docker cp ${WORKSPACE_PATH}/. test:/home/user1/qa-example-content/`, 'Copy workspace to container');

	// Copy merged settings to container
	await copySettingsToContainer();

	// Copy keybindings to container
	const fixturesDir = path.join(ROOT_PATH, 'test/e2e/fixtures');
	const keybindingsFile = path.join(fixturesDir, 'keybindings.json');
	await runDockerCommand(`docker cp ${keybindingsFile} test:/home/user1/.positron-server/User/keybindings.json`, 'Copy keybindings to container');

	// Fix permissions
	await runDockerCommand('docker exec test chown -R user1:user1g /home/user1/.positron-server/', 'Set ownership of settings directory');
	await runDockerCommand('docker exec test chown -R user1 /home/user1/qa-example-content/', 'Set ownership of workspace directory');
	await runDockerCommand('docker exec test chmod -R 755 /home/user1/.positron-server/User/', 'Set permissions of settings directory');
	await runDockerCommand('docker exec test chmod -R 755 /home/user1/qa-example-content/', 'Set permissions of workspace directory');
}

/**
 * Run a Docker command with error handling and logging
 */
async function runDockerCommand(command: string, description: string): Promise<void> {
	try {
		// console.log(`✓ ${description}...`);
		execSync(command, { stdio: 'inherit' });
	} catch (error) {
		console.error(`Failed to ${description.toLowerCase()}:`, error);
		throw error;
	}
}

/**
 * Copy merged settings (base + Docker overrides) to the container
 */
async function copySettingsToContainer(): Promise<void> {
	const fixturesDir = path.join(ROOT_PATH, 'test/e2e/fixtures');
	const userSettingsFile = path.join(fixturesDir, 'settings.json');
	const dockerSettingsFile = path.join(fixturesDir, 'settingsDocker.json');

	// Merge settings
	const mergedSettings = {
		...JSON.parse(fs.readFileSync(userSettingsFile, 'utf8')),
		...JSON.parse(fs.readFileSync(dockerSettingsFile, 'utf8')),
	};

	// Create temporary merged settings file
	const tempSettingsFile = path.join(fixturesDir, 'settings-merged.json');
	fs.writeFileSync(tempSettingsFile, JSON.stringify(mergedSettings, null, 2));

	try {
		// Copy to container
		await runDockerCommand(`docker cp ${tempSettingsFile} test:/home/user1/.positron-server/User/settings.json`, 'Copy settings to container');
	} finally {
		// Clean up temporary file
		fs.unlinkSync(tempSettingsFile);
	}
}
