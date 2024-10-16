/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as base, type Page, _electron } from '@playwright/test';
export { expect } from '@playwright/test';
import { spawnSync } from 'child_process';
import path = require('path');
import fs = require('fs');
import os = require('os');
import { join } from 'path';

import { cloneTestRepo, prepareTestEnv } from '../test-runner';
import minimist = require('minimist');

export type TestOptions = {
	vscodeVersion: string;
};

type TestFixtures = TestOptions & {
	workbox: Page;
	createProject: () => Promise<string>;
	createTempDir: () => Promise<string>;
	defaultOptions: any;
};

import { createLogger } from '../test-runner/logger';
import { resolveElectronConfiguration } from '../../../automation/out/electron';

export const test = base.extend<TestFixtures>({
	vscodeVersion: ['insiders', { option: true }],
	defaultOptions: async ({ }, use) => {
		const LOGS_DIR = process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || 'smoke-tests-default';
		const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
		const EXTENSIONS_PATH = join(TEST_DATA_PATH, 'extensions-dir');
		const WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');
		const OPTS = minimist(process.argv.slice(2));
		const ROOT_PATH = join(__dirname, '..', '..', '..', '..');

		const suiteName = 'default_suite'; // Dynamic suite name logic here
		const logsRootPath = join(ROOT_PATH, '.build', 'logs', LOGS_DIR, suiteName);
		const crashesRootPath = join(ROOT_PATH, '.build', 'crashes', LOGS_DIR, suiteName);
		const logger = createLogger(logsRootPath);
		const options = {
			codePath: OPTS.build,
			workspacePath: WORKSPACE_PATH,
			userDataDir: join(TEST_DATA_PATH, 'd'),
			extensionsPath: EXTENSIONS_PATH,
			logger,
			logsPath: join(logsRootPath, 'suite_unknown'),
			crashesPath: join(crashesRootPath, 'suite_unknown'),
			verbose: OPTS.verbose,
			remote: OPTS.remote,
			web: OPTS.web,
			// tracing: false,
			headless: OPTS.headless,
			browser: OPTS.browser,
			extraArgs: (OPTS.electronArgs || '').split(' ').map(arg => arg.trim()).filter(arg => !!arg),
		};

		// need to move into global setup
		prepareTestEnv(ROOT_PATH);
		cloneTestRepo(WORKSPACE_PATH);

		await use(options);
	},
	workbox: async ({ vscodeVersion, createProject, createTempDir, defaultOptions }, use) => {
		const defaultCachePath = await createTempDir();
		console.log(`defaultCachePath: ${defaultCachePath}`);
		console.log('options', defaultOptions.userDataDir);

		// Resolve electron config and update
		const { electronPath, args, env } = await resolveElectronConfiguration(defaultOptions);
		args.push('--enable-smoke-test-driver');

		// Launch electron via playwright
		const electronApp = await _electron.launch({
			executablePath: electronPath,
			args: args,
			env: env as { [key: string]: string },
			timeout: 0
		});
		const workbox = await electronApp.firstWindow();
		await workbox.context().tracing.start({ screenshots: true, snapshots: true, title: test.info().title });
		await use(workbox);
		const tracePath = test.info().outputPath('trace.zip');
		await workbox.context().tracing.stop({ path: tracePath });
		test.info().attachments.push({ name: 'trace', path: tracePath, contentType: 'application/zip' });
		await electronApp.close();
		// await app.stop();
		const logPath = path.join(defaultCachePath, 'user-data');
		if (fs.existsSync(logPath)) {
			const logOutputPath = test.info().outputPath('vscode-logs');
			await fs.promises.cp(logPath, logOutputPath, { recursive: true });
		}
	},
	createProject: async ({ createTempDir }, use) => {
		await use(async () => {
			// We want to be outside of the project directory to avoid already installed dependencies.
			const projectPath = await createTempDir();
			if (fs.existsSync(projectPath)) { await fs.promises.rm(projectPath, { recursive: true }); }
			console.log(`Creating project in ${projectPath}`);
			await fs.promises.mkdir(projectPath);
			spawnSync(`npm init playwright@latest --yes -- --quiet --browser=chromium --gha --install-deps`, {
				cwd: projectPath,
				stdio: 'inherit',
				shell: true,
			});
			return projectPath;
		});
	},
	createTempDir: async ({ }, use) => {
		const tempDirs: string[] = [];
		await use(async () => {
			const tempDir = await fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir())));
			tempDirs.push(tempDir);
			return tempDir;
		});
		for (const tempDir of tempDirs) { await fs.promises.rm(tempDir, { recursive: true }); }
	}
});
