/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path = require('path');
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as playwright from '@playwright/test';
import { ApplicationOptions, copyFixtureFile, Quality, getRandomUserDataDir } from '../../infra';
import { ROOT_PATH, TEMP_DIR } from './constants';

export interface CustomTestOptions {
	web: boolean;
	artifactDir: string;
	headless?: boolean;
	/**
	 * When true, connects to an existing server instead of launching one.
	 * Use with externalServerUrl to specify the server to connect to.
	 */
	useExternalServer?: boolean;
	/**
	 * The URL of an external server to connect to.
	 * Only used when useExternalServer is true.
	 */
	externalServerUrl?: string;
}

export function OptionsFixture() {
	return async (logsPath: string, logger: any, snapshots: boolean, project: CustomTestOptions, workerInfo: playwright.WorkerInfo) => {
		const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
		const EXTENSIONS_PATH = join(TEST_DATA_PATH, 'extensions-dir');
		const WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');
		const SPEC_CRASHES_PATH = join(ROOT_PATH, '.build', 'crashes', project.artifactDir, TEMP_DIR);

		// get the version from package.json
		const packageJsonPath = join(ROOT_PATH, 'package.json');
		const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf-8'));
		const packageVersion = packageJson.version || '0.0.0';
		const version = {
			major: parseInt(packageVersion.split('.')[0], 10),
			minor: parseInt(packageVersion.split('.')[1], 10),
			patch: parseInt(packageVersion.split('.')[2], 10),
		};

		const options: ApplicationOptions = {
			codePath: process.env.BUILD,
			workspacePath: WORKSPACE_PATH,
			userDataDir: join(TEST_DATA_PATH, 'd'),
			extensionsPath: EXTENSIONS_PATH,
			logger,
			logsPath,
			crashesPath: SPEC_CRASHES_PATH,
			verbose: !!process.env.VERBOSE,
			remote: !!process.env.REMOTE,
			web: project.web,
			headless: project.headless,
			tracing: true,
			snapshots,
			quality: Quality.Dev,
			version,
			useExternalServer: project.useExternalServer,
			externalServerUrl: project.externalServerUrl
		};

		options.userDataDir = getRandomUserDataDir(options);

		return options;
	};
}

export function UserDataDirFixture() {
	return async (options: ApplicationOptions) => {
		const userDir = options.web ? join(options.userDataDir, 'data', 'User') : join(options.userDataDir, 'User');
		process.env.PLAYWRIGHT_USER_DATA_DIR = userDir;

		// Copy keybindings and settings fixtures to the user data directory
		await copyFixtureFile('keybindings.json', userDir, true);

		const settingsFileName = 'settings.json';
		if (fs.existsSync('/.dockerenv')) {

			const fixturesDir = path.join(ROOT_PATH, 'test/e2e/fixtures');
			const settingsFile = path.join(fixturesDir, 'settings.json');

			const mergedSettings = {
				...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
				...JSON.parse(fs.readFileSync(path.join(fixturesDir, 'settingsDocker.json'), 'utf8')),
			};

			// Overwrite file
			fs.writeFileSync(settingsFile, JSON.stringify(mergedSettings, null, 2));
		}

		await copyFixtureFile(settingsFileName, userDir);

		return userDir;
	};
}
