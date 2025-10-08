/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { join } from 'path';
import { exec } from 'child_process';
import { Application, createApp } from '../../infra';
import { AppFixtureOptions } from './app.fixtures';
import { ROOT_PATH } from './constants';
import { promisify } from 'util';
const execP = promisify(exec);

export type RunResult = {
	stdout: string;
	stderr: string;
	code?: number;      // best-effort exit code (populated on failure)
	signal?: NodeJS.Signals | null;
};

/**
 * Workbench Positron session (Docker on port 8787)
 * Projects: e2e-workbench
 */

export async function WorkbenchApp(
	fixtureOptions: AppFixtureOptions
): Promise<{ app: Application; start: () => Promise<void>; stop: () => Promise<void> }> {
	const { options } = fixtureOptions;
	const { workspacePath } = await setupWorkbenchEnvironment();

	const app = createApp({ ...options, workspacePath });

	const start = async () => {
		await app.connectToExternalServer();

		// Workbench: Login to Posit Workbench
		await app.positWorkbench.auth.signIn();
		await app.positWorkbench.dashboard.expectHeaderToBeVisible();
		await app.positWorkbench.dashboard.openSession('qa-example-content');

		// Wait for Positron to be ready
		await app.code.driver.page.waitForSelector('.monaco-workbench', { timeout: 60000 });
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
 * Setup the complete Workbench environment: Docker container, configuration, and permissions
 */
async function setupWorkbenchEnvironment(): Promise<{ workspacePath: string; userDataDir: string }> {
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
	await copyUserSettingsToContainer();
	await copyKeyBindingsToContainer();

	// Fix permissions
	await runDockerCommand(`docker exec test chown -R user1:user1g ${WORKBENCH_USER_SERVER_DIR}`, 'Set ownership of server directory');
	await runDockerCommand(`docker exec test chown -R user1 ${WORKBENCH_WORKSPACE_PATH}`, 'Set ownership of workspace directory');
	await runDockerCommand(`docker exec test chmod -R 755 ${WORKBENCH_USER_DATA_DIR}`, 'Set permissions of settings directory');
	await runDockerCommand(`docker exec test chmod -R 755 ${WORKBENCH_WORKSPACE_PATH}`, 'Set permissions of workspace directory');

	return { workspacePath: WORKBENCH_WORKSPACE_PATH, userDataDir: WORKBENCH_USER_DATA_DIR };
}

/**
 * Run a Docker command with error handling and logging
 */
export async function runDockerCommand(command: string, description: string): Promise<RunResult> {
	try {
		// Increase buffers for commands that produce lots of output (pull, build, logs, etc.)
		const { stdout, stderr } = await execP(command, {
			maxBuffer: 1024 * 1024 * 20, // 20 MB
			timeout: 0,                   // no timeout
			shell: '/bin/bash',           // so things like pipes && envs work consistently
		});
		return { stdout, stderr };
	} catch (err: any) {
		// exec throws with an Error that includes stdout/stderr and possibly signal/code
		const result: RunResult = {
			stdout: err.stdout ?? '',
			stderr: err.stderr ?? String(err.message ?? ''),
			code: typeof err.code === 'number' ? err.code : undefined,
			signal: err.signal ?? null,
		};
		// Re-throw with richer context but preserve captured output for callers
		const wrapped = new Error(
			`Failed to ${description.toLowerCase()} (exit ${result.code ?? 'unknown'}):\n${result.stderr}`
		);
		(wrapped as any).result = result;
		throw wrapped;
	}
}

/**
 * Copy merged settings (base + Docker overrides) to the container
 */
async function copyUserSettingsToContainer(): Promise<void> {
	const fixturesDir = path.join(ROOT_PATH, 'test/e2e/fixtures');
	const userSettingsFile = path.join(fixturesDir, 'settings.json');
	const dockerSettingsFile = path.join(fixturesDir, 'settingsDocker.json');
	const workbenchSettingsFile = path.join(fixturesDir, 'settingsWorkbench.json');

	// Merge settings
	const mergedSettings = {
		...JSON.parse(fs.readFileSync(userSettingsFile, 'utf8')),
		...JSON.parse(fs.readFileSync(dockerSettingsFile, 'utf8')),
		...JSON.parse(fs.readFileSync(workbenchSettingsFile, 'utf8')),
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

export async function copyKeyBindingsToContainer(): Promise<void> {
	const fixturesDir = path.join(ROOT_PATH, 'test/e2e/fixtures');
	const src = path.join(fixturesDir, 'keybindings.json');

	const original = await fs.promises.readFile(src, 'utf8');
	const modifier = process.platform === 'darwin' ? 'cmd' : 'ctrl';
	const adjusted = original.replace(/cmd/gi, modifier);

	const tmpFile = path.join(os.tmpdir(), `keybindings.${Date.now()}.json`);
	await fs.promises.writeFile(tmpFile, adjusted, 'utf8');

	const containerPath = '/home/user1/.positron-server/User/keybindings.json';

	await runDockerCommand(
		`docker cp "${tmpFile}" test:"${containerPath}"`,
		'Copy keybindings to container'
	);

	// Cleanup
	await fs.promises.unlink(tmpFile);
}
