/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Playwright and testing imports
import * as playwright from '@playwright/test';
const { test: base, expect: playwrightExpect } = playwright;

// Node.js built-in modules
import { join } from 'path';
import * as os from 'os';
import * as fs from 'fs';
import path = require('path');
// eslint-disable-next-line local/code-import-patterns
import { rename, rm, access, mkdir } from 'fs/promises';
import { constants } from 'fs';
import { randomUUID } from 'crypto';

// Third-party packages
import archiver from 'archiver';

// Local imports
import { Application, Setting, SettingsFixture, createLogger, createApp, TestTags, Sessions, HotKeys, TestTeardown, getRandomUserDataDir, createPositronSettingsManager, vsCodeSettings, ApplicationOptions, Quality, MultiLogger } from '../infra';
import { PackageManager } from '../pages/utils/packageManager';

// Constants
const TEMP_DIR = `temp-${randomUUID()}`;
const ROOT_PATH = process.cwd();
const LOGS_ROOT_PATH = join(ROOT_PATH, 'test-logs');
let SPEC_NAME = '';
let fixtureScreenshot: Buffer;

// Currents fixtures
import {
	CurrentsFixtures,
	CurrentsWorkerFixtures,
	fixtures as currentsFixtures
	// eslint-disable-next-line local/code-import-patterns
} from '@currents/playwright';
import { UserSettingsFileManager } from '../pages/utils/userSettingsFileManager.js';
import { ContextMenu } from '../infra/contextMenu.js';


// Test fixtures
export const test = base.extend<TestFixtures & CurrentsFixtures, WorkerFixtures & CurrentsWorkerFixtures>({
	...currentsFixtures.baseFixtures,
	...currentsFixtures.actionFixtures,
	suiteId: ['', { scope: 'worker', option: true }],

	snapshots: [true, { scope: 'worker', auto: true }],

	logsPath: [async ({ }, use, workerInfo) => {
		const project = workerInfo.project.use as CustomTestOptions;
		const logsPath = join(LOGS_ROOT_PATH, project.artifactDir, TEMP_DIR);
		await use(logsPath);
	}, { scope: 'worker', auto: true }],

	logger: [async ({ logsPath }, use) => {
		const logger = createLogger(logsPath);
		await use(logger);
	}, { auto: true, scope: 'worker' }],

	options: [async ({ logsPath, logger, snapshots }, use, workerInfo) => {
		const project = workerInfo.project.use as CustomTestOptions;
		const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
		const EXTENSIONS_PATH = join(TEST_DATA_PATH, 'extensions-dir');
		const WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');
		const SPEC_CRASHES_PATH = join(ROOT_PATH, '.build', 'crashes', project.artifactDir, TEMP_DIR);

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
		};
		options.userDataDir = getRandomUserDataDir(options);

		await use(options);
	}, { scope: 'worker', auto: true }],

	userDataDir: [async ({ options }, use) => {
		await use(options.userDataDir);
	}, { scope: 'worker' }],

	restartApp: [async ({ app }, use) => {
		await app.restart();
		await app.workbench.sessions.expectNoStartUpMessaging();

		await use(app);
	}, { scope: 'test', timeout: 60000 }],

	app: [async ({ options, logsPath, logger }, use, workerInfo) => {
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
					fixtureScreenshot = await page.screenshot({ path: screenshotPath });
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
	}, { scope: 'worker', auto: true, timeout: 80000 }],

	sessions: [
		async ({ app }, use) => {
			await use(app.workbench.sessions);
		},
		{ scope: 'test' }
	],

	r: [
		async ({ sessions }, use) => {
			await sessions.start('r', { reuse: true });
			await use();
		},
		{ scope: 'test' }
	],

	python: [
		async ({ sessions }, use) => {
			await sessions.start('python', { reuse: true });
			await use();
		},
		{ scope: 'test' }],

	// ex: await packages.manage('ipykernel', 'install');
	// ex: await packages.manage('renv', 'uninstall');
	packages: [async ({ app }, use) => {
		const packageManager = new PackageManager(app);
		await use(packageManager);
	}, { scope: 'test' }],

	devTools: [async ({ app }, use) => {
		await app.workbench.quickaccess.runCommand('workbench.action.toggleDevTools');
		await use();
	}, { scope: 'test' }],

	// This fixture provides a way interact with context menu items for both Electron and web apps. :tada:
	contextMenu: [async ({ app }, use, testInfo) => {
		const contextMenu = new ContextMenu(app.code, testInfo.project.name, process.platform);
		await use(contextMenu);
	},
	{ scope: 'test' }],

	// ex: await openFile('workspaces/basic-rmd-file/basicRmd.rmd');
	openFile: async ({ app }, use) => {
		await use(async (filePath: string, waitForFocus = true) => {
			await test.step(`Open file: ${path.basename(filePath)}`, async () => {
				await app.workbench.quickaccess.openFile(path.join(app.workspacePathOrFolder, filePath), waitForFocus);
			});
		});
	},

	// ex: await openDataFile('workspaces/large_r_notebook/spotify.ipynb');
	openDataFile: async ({ app }, use) => {
		await use(async (filePath: string) => {
			await test.step(`Open data file: ${path.basename(filePath)}`, async () => {
				await app.workbench.quickaccess.openDataFile(path.join(app.workspacePathOrFolder, filePath));
			});
		});
	},

	// ex: await openFolder(path.join('qa-example-content/workspaces/r_testing'));
	openFolder: async ({ app }, use) => {
		await use(async (folderPath: string) => {
			await test.step(`Open folder: ${folderPath}`, async () => {
				await app.workbench.quickaccess.runCommand('workbench.action.files.openFolder', { keepOpen: true });
				await playwright.expect(app.workbench.quickInput.quickInputList.locator('a').filter({ hasText: '..' })).toBeVisible();

				const folderNames = folderPath.split('/');

				for (const folderName of folderNames) {
					await app.workbench.quickInput.quickInput.pressSequentially(folderName + '/');
					const quickInputOption = app.workbench.quickInput.quickInput.getByRole('option', { name: folderName });
					await playwright.expect(quickInputOption).not.toBeVisible();
				}

				await app.workbench.quickInput.clickOkButton();
			});
		});
	},

	// ex: await runCommand('workbench.action.files.save');
	runCommand: async ({ app }, use) => {
		await use(async (command: string, options?: { keepOpen?: boolean; exactMatch?: boolean }) => {
			await app.workbench.quickaccess.runCommand(command, options);
		});
	},

	// ex: await executeCode('Python', 'print("Hello, world!")');
	executeCode: async ({ app }, use) => {
		await use(async (language: 'Python' | 'R', code: string, options?: {
			timeout?: number;
			waitForReady?: boolean;
			maximizeConsole?: boolean;
		}) => {
			await app.workbench.console.executeCode(language, code, options);
		});
	},


	// ex: await hotKeys.copy();
	hotKeys: async ({ app }, use) => {
		const hotKeys = app.workbench.hotKeys;
		await use(hotKeys);
	},

	// ex: await userSettings.set([['editor.actionBar.enabled', 'true']], false);
	userSettings: [async ({ app }, use) => {
		const userSettings = new SettingsFixture(app);

		const setUserSetting = async (
			settings: [string, string][],
			restartApp = false
		) => {
			await userSettings.setMultiple(settings, restartApp);
			await app.workbench.sessions.expectNoStartUpMessaging();
		};

		await use({
			set: setUserSetting
		});

		await userSettings.unset();
	}, { scope: 'worker' }],

	workspaceSettings: [async ({ app }, use) => {
		const workspaceSettings = new SettingsFixture(app);

		const setWorkspaceSetting = async (
			settings: [string, string][],
			restartApp = false
		) => {
			await workspaceSettings.setMultiple(settings, restartApp);
			await app.workbench.sessions.expectNoStartUpMessaging();
		};

		await use({
			set: setWorkspaceSetting
		});

		await workspaceSettings.unset();
	}, { scope: 'worker' }],

	vscodeUserSettings: [async ({ }, use) => {
		const manager = vsCodeSettings;
		await manager.backupIfExists();

		await use(manager);

		await manager.restoreFromBackup();
	}, { scope: 'worker' }],

	positronUserSettings: [async ({ userDataDir }, use) => {
		const manager = createPositronSettingsManager(userDataDir);
		await manager.backupIfExists();

		await use(manager);

		await manager.restoreFromBackup();
	}, { scope: 'worker' }],

	attachScreenshotsToReport: [async ({ app }, use, testInfo) => {
		let screenShotCounter = 1;
		const page = app.code.driver.page;
		const screenshots: string[] = [];

		app.code.driver.takeScreenshot = async function (name: string) {
			const screenshotPath = testInfo.outputPath(`${screenShotCounter++}-${name}.png`);
			await page.screenshot({ path: screenshotPath });
			screenshots.push(screenshotPath);
		};

		await use();

		// if test failed, take and attach screenshot
		if (testInfo.status !== testInfo.expectedStatus) {
			const screenshot = await page.screenshot();
			await testInfo.attach('on-test-end', { body: screenshot, contentType: 'image/png' });
		}

		for (const screenshotPath of screenshots) {
			testInfo.attachments.push({ name: path.basename(screenshotPath), path: screenshotPath, contentType: 'image/png' });
		}
	}, { auto: true }],

	attachLogsToReport: [async ({ suiteId, logsPath }, use, testInfo) => {
		await use();

		if (!suiteId) { return; }

		const zipPath = path.join(logsPath, 'logs.zip');
		const output = fs.createWriteStream(zipPath);
		const archive = archiver('zip', { zlib: { level: 9 } });

		archive.on('error', (err) => {
			throw err;
		});

		archive.pipe(output);

		// add all log files to the archive
		archive.glob('**/*', { cwd: logsPath, ignore: ['logs.zip'] });

		// wait for the archive to finalize and the output stream to close
		await new Promise((resolve, reject) => {
			output.on('close', resolve);
			output.on('error', reject);
			archive.finalize();
		});

		// attach the zipped file to the report
		await testInfo.attach(`logs-${path.basename(testInfo.file)}.zip`, {
			path: zipPath,
			contentType: 'application/zip',
		});

		// remove the logs.zip file
		try {
			await fs.promises.unlink(zipPath);
		} catch (err) {
			console.error(`Failed to remove ${zipPath}:`, err);
		}
	}, { auto: true }],

	tracing: [async ({ app }, use, testInfo) => {
		// Determine execution mode
		const isCommandLineRun = process.env.npm_execpath && !(process.env.PW_UI_MODE === 'true');

		// Use default built-in tracing for e2e-browser except when running via CLI
		if (testInfo.project.name === 'e2e-browser' && !isCommandLineRun) {
			await use(app);
		} else {
			// start tracing
			await app.startTracing(testInfo.titlePath.join(' › '));

			await use(app);

			// stop tracing
			const title = path.basename(`_trace`); // do NOT use title of 'trace' - conflicts with the default trace
			const tracePath = testInfo.outputPath(`${title}.zip`);
			await app.stopTracing(title, true, tracePath);

			// attach the trace to the report if CI and test failed or not in CI
			const isCI = process.env.CI === 'true';
			if (!isCI || testInfo.status !== testInfo.expectedStatus || testInfo.retry) {
				testInfo.attachments.push({ name: 'trace', path: tracePath, contentType: 'application/zip' });
			}
		}

	}, { auto: true, scope: 'test' }],

	page: async ({ app }, use) => {
		await use(app.code.driver.page);
	},

	autoTestFixture: [async ({ logger, suiteId, app }, use, testInfo) => {
		if (!suiteId) { throw new Error('suiteId is required'); }

		logger.log('');
		logger.log(`>>> Test start: '${testInfo.title ?? 'unknown'}' <<<`);
		logger.log('');

		await use();

		await app.workbench.console.logConsoleContents();
		await app.workbench.terminal.logTerminalContents();

		const failed = testInfo.status !== testInfo.expectedStatus;
		const testTitle = testInfo.title;
		const endLog = failed ? `>>> !!! FAILURE !!! Test end: '${testTitle}' !!! FAILURE !!! <<<` : `>>> Test end: '${testTitle}' <<<`;

		logger.log('');
		logger.log(endLog);
		logger.log('');
	}, { scope: 'test', auto: true }],

	cleanup: async ({ app }, use) => {
		const cleanup = new TestTeardown(app.workspacePathOrFolder);
		await use(cleanup);
	},
});

// Runs once per worker. If a worker handles multiple specs, these hooks only run for the first spec.
// However, we are using `suiteId` to ensure each suite gets a new worker (and a fresh app
// instance). This also ensures these before/afterAll hooks will run for EACH spec
test.beforeAll(async ({ logger }, testInfo) => {
	// since the worker doesn't know or have access to the spec name when it starts,
	// we store the spec name in a global variable. this ensures logs are written
	// to the correct folder even when the app is scoped to "worker".
	// by storing the spec name globally, we can rename the logs folder after the suite finishes.
	// note: workers are intentionally restarted per spec to scope logs by spec
	// and provide a fresh app instance for each spec.
	SPEC_NAME = testInfo.titlePath[0];
	logger.log('');
	logger.log(`>>> Suite start: '${testInfo.titlePath[0] ?? 'unknown'}' <<<`);
	logger.log('');
});

test.afterAll(async function ({ logger }, testInfo) {
	try {
		logger.log('');
		logger.log(`>>> Suite end: '${testInfo.titlePath[0] ?? 'unknown'}' <<<`);
		logger.log('');
	} catch (error) {
		// ignore
	}

	if (fixtureScreenshot) {
		await testInfo.attach('on-fixture-fail', { body: fixtureScreenshot, contentType: 'image/png' });
	}
});

export { playwrightExpect as expect };
export { TestTags as tags };

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

interface TestFixtures {
	restartApp: Application;
	tracing: any;
	page: playwright.Page;
	attachScreenshotsToReport: any;
	attachLogsToReport: any;
	sessions: Sessions;
	r: void;
	python: void;
	packages: PackageManager;
	autoTestFixture: any;
	devTools: void;
	contextMenu: ContextMenu;
	openFile: (filePath: string, waitForFocus?: boolean) => Promise<void>;
	openDataFile: (filePath: string) => Promise<void>;
	openFolder: (folderPath: string) => Promise<void>;
	runCommand: (command: string, options?: { keepOpen?: boolean; exactMatch?: boolean }) => Promise<void>;
	executeCode: (language: 'Python' | 'R', code: string, options?: {
		timeout?: number;
		waitForReady?: boolean;
		maximizeConsole?: boolean;
	}) => Promise<void>;
	hotKeys: HotKeys;
	cleanup: TestTeardown;
}

interface WorkerFixtures {
	suiteId: string;
	snapshots: boolean;
	artifactDir: string;
	options: any;
	userDataDir: string;
	app: Application;
	logsPath: string;
	logger: MultiLogger;
	userSettings: {
		set: (settings: Setting[], restartApp?: boolean) => Promise<void>;
	};
	workspaceSettings: {
		set: (settings: Setting[], restartApp?: boolean) => Promise<void>;
	};
	vscodeUserSettings: UserSettingsFileManager;
	positronUserSettings: UserSettingsFileManager;
}

export type CustomTestOptions = playwright.PlaywrightTestOptions & {
	web: boolean;
	artifactDir: string;
	headless?: boolean;
};

