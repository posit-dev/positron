/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as base, type Page, _electron } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron/out/download';
export { expect } from '@playwright/test';
import { spawnSync } from 'child_process';
import path = require('path');
import fs = require('fs');
import os = require('os');

export type TestOptions = {
	vscodeVersion: string;
};

type TestFixtures = TestOptions & {
	workbox: Page;
	createProject: () => Promise<string>;
	createTempDir: () => Promise<string>;
};

export const test = base.extend<TestFixtures>({
	vscodeVersion: ['insiders', { option: true }],
	workbox: async ({ vscodeVersion, createProject, createTempDir }, use) => {
		const defaultCachePath = await createTempDir();
		console.log(`defaultCachePath: ${defaultCachePath}`);
		const vscodePath = await downloadAndUnzipVSCode(vscodeVersion);
		console.log(`vscodePath: ${vscodePath}`);

		// const positronPath = '/Users/marieidleman/Develop/positron/.build/electron/Positron.app/Contents/MacOS/Electron';
		const electronApp = await _electron.launch({
			executablePath: vscodePath,
			args: [
				// Stolen from https://github.com/microsoft/vscode-test/blob/0ec222ef170e102244569064a12898fb203e5bb7/lib/runTest.ts#L126-L160
				// https://github.com/microsoft/vscode/issues/84238
				'--no-sandbox',
				// https://github.com/microsoft/vscode-test/issues/221
				'--disable-gpu-sandbox',
				// https://github.com/microsoft/vscode-test/issues/120
				'--disable-updates',
				'--skip-welcome',
				'--skip-release-notes',
				'--disable-workspace-trust',
				// `--extensionDevelopmentPath=${path.join(__dirname, '..', '..')}`,
				`--extensions-dir=${path.join(defaultCachePath, 'extensions')}`,
				`--user-data-dir=${path.join(defaultCachePath, 'user-data')}`,
				await createProject(),
			],
		});
		const workbox = await electronApp.firstWindow();
		await workbox.context().tracing.start({ screenshots: true, snapshots: true, title: test.info().title });
		await use(workbox);
		const tracePath = test.info().outputPath('trace.zip');
		await workbox.context().tracing.stop({ path: tracePath });
		test.info().attachments.push({ name: 'trace', path: tracePath, contentType: 'application/zip' });
		await electronApp.close();
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
