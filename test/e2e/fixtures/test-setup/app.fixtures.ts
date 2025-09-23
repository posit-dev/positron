/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path = require('path');
import { join } from 'path';
import * as fs from 'fs';
import { constants, access, rm, mkdir, rename } from 'fs/promises';
import * as os from 'os';
import * as playwright from '@playwright/test';
import { Application, ApplicationOptions, MultiLogger, createApp, copyFixtureFile, Quality, getRandomUserDataDir } from '../../infra';
import { SPEC_NAME, setFixtureScreenshot, ROOT_PATH, TEMP_DIR } from './constants';

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

export interface AppFixtureOptions {
	options: ApplicationOptions;
	logsPath: string;
	logger: MultiLogger;
	workerInfo: playwright.WorkerInfo;
}

export function OptionsFixture() {
	return async (logsPath: string, logger: MultiLogger, snapshots: boolean, project: CustomTestOptions) => {
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
		const userDataDir = options.userDataDir || '';
		const userDir = options.web ? join(userDataDir, 'data', 'User') : join(userDataDir, 'User');
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

export function AppFixture() {
	return async (fixtureOptions: AppFixtureOptions, use: (arg0: Application) => Promise<void>) => {
		const { options, logsPath, logger, workerInfo } = fixtureOptions;

		// For external server mode, use a different approach
		if (options.useExternalServer) {
			return await ExternalServerAppFixture()(fixtureOptions, use);
		}

		// Standard app fixture for managed servers/electron
		const app = createApp(options);

		try {
			await app.start();
			await app.workbench.sessions.expectNoStartUpMessaging();

			await use(app);
		} catch (error) {
			// capture a screenshot on failure
			const screenshotPath = path.join(logsPath, 'app-start-failure.png');
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
			await app.stop();

			// rename the temp logs dir to the spec name (if available)
			const specLogsPath = path.join(path.dirname(logsPath), SPEC_NAME || `worker-${workerInfo.workerIndex}`);
			await moveAndOverwrite(logger, logsPath, specLogsPath);
		}
	};
}

export function ExternalServerAppFixture() {
	return async (fixtureOptions: AppFixtureOptions, use: (arg0: Application) => Promise<void>) => {
		const { options, logsPath, logger, workerInfo } = fixtureOptions;

		// For external server mode, use the server's actual user data directory
		const serverUserDataDir = join(os.homedir(), '.positron-e2e-test');
		const userDir = join(serverUserDataDir, 'User');

		console.log('External server user data dir:', serverUserDataDir);
		await mkdir(userDir, { recursive: true });
		await copyFixtureFile('keybindings.json', userDir, true);
		await copyFixtureFile('settings.json', userDir);

		const app = createApp(options);

		try {
			// For external server, we don't launch the app, just connect to it
			await app.connectToExternalServer();

			// workaround since we have rogue sessions at startup
			await app.workbench.sessions.expectNoStartUpMessaging();
			await app.workbench.hotKeys.closeAllEditors();
			await app.workbench.sessions.deleteAll();

			await use(app);
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
			const specLogsPath = path.join(path.dirname(logsPath), SPEC_NAME || `worker-${workerInfo.workerIndex}`);
			await moveAndOverwrite(logger, logsPath, specLogsPath);
		}
	};
}

async function moveAndOverwrite(logger: MultiLogger, sourcePath: string, destinationPath: string) {
	try {
		await access(sourcePath, constants.F_OK);
	} catch {
		console.error(`moveAndOverwrite: source path does not exist: ${sourcePath}`);
		return;
	}

	// check if the destination exists and delete it if so
	try {
		await access(destinationPath, constants.F_OK);
		await rm(destinationPath, { recursive: true, force: true });
	} catch (err) { }

	// ensure parent directory of destination path exists
	const destinationDir = path.dirname(destinationPath);
	await mkdir(destinationDir, { recursive: true });

	// rename source to destination
	try {
		await rename(sourcePath, destinationPath);
		logger.setPath(destinationPath);
		logger.log('Logger path updated to:', destinationPath);
	} catch (err) {
		logger.log(`moveAndOverwrite: failed to move ${sourcePath} to ${destinationPath}:`, err);
	}
}
