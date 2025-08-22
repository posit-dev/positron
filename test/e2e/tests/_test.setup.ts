/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Playwright and testing imports
import * as playwright from '@playwright/test';
const { test: base, expect: playwrightExpect } = playwright;

// Node.js built-in modules
import { join } from 'path';

// Local imports
import { Application, createLogger, TestTags, Sessions, HotKeys, TestTeardown, ApplicationOptions, MultiLogger, VscodeSettings } from '../infra';
import { PackageManager } from '../pages/utils/packageManager';
import {
	FileOperationsFixture, SettingsFixture, MetricsFixture,
	AttachScreenshotsToReportFixture, AttachLogsToReportFixture,
	TracingFixture, AppFixture, UserDataDirFixture, OptionsFixture,
	CustomTestOptions, TEMP_DIR, LOGS_ROOT_PATH, fixtureScreenshot, setSpecName
} from '../fixtures/test-setup';
import { RecordMetric } from '../utils/metrics/metric-base.js';

// Currents fixtures
import {
	CurrentsFixtures,
	CurrentsWorkerFixtures,
	fixtures as currentsFixtures
	// eslint-disable-next-line local/code-import-patterns
} from '@currents/playwright';


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
		const optionsFixture = OptionsFixture();
		const options = await optionsFixture(logsPath, logger, snapshots, project);

		await use(options);
	}, { scope: 'worker', auto: true }],

	userDataDir: [async ({ options }, use) => {
		const userDataDirFixture = UserDataDirFixture();
		const userDir = await userDataDirFixture(options);

		await use(userDir);
	}, { scope: 'worker', auto: true }],

	restartApp: [async ({ app }, use) => {
		await app.restart();
		await app.workbench.sessions.expectNoStartUpMessaging();

		await use(app);
	}, { scope: 'test', timeout: 60000 }],

	app: [async ({ options, logsPath, logger }, use, workerInfo) => {
		const appFixture = AppFixture();
		await appFixture({ options, logsPath, logger, workerInfo }, use);
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

	// ex: await openFile('workspaces/basic-rmd-file/basicRmd.rmd');
	openFile: async ({ app }, use) => {
		const fileOps = FileOperationsFixture(app);
		await use(fileOps.openFile);
	},

	// ex: await openDataFile('workspaces/large_r_notebook/spotify.ipynb');
	openDataFile: async ({ app }, use) => {
		const fileOps = FileOperationsFixture(app);
		await use(fileOps.openDataFile);
	},

	// ex: await openFolder(path.join('qa-example-content/workspaces/r_testing'));
	openFolder: async ({ app }, use) => {
		const fileOps = FileOperationsFixture(app);
		await use(fileOps.openFolder);
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

	// ex: await settings.set({'editor.actionBar.enabled': true});
	settings: [async ({ app }, use) => {
		const settingsFixture = SettingsFixture(app);
		await use(settingsFixture);
	}, { scope: 'worker' }],

	vsCodeSettings: [async ({ }, use) => {
		const manager = new VscodeSettings(VscodeSettings.getVSCodeSettingsPath());
		await manager.backupIfExists();
		await use(manager);
		await manager.restoreFromBackup();
	}, { scope: 'worker' }],

	attachScreenshotsToReport: [async ({ app }, use, testInfo) => {
		const attachScreenshotsFixture = AttachScreenshotsToReportFixture();
		await attachScreenshotsFixture({ app, testInfo }, use);
	}, { auto: true }],

	attachLogsToReport: [async ({ suiteId, logsPath }, use, testInfo) => {
		const attachLogsFixture = AttachLogsToReportFixture();
		await attachLogsFixture({ suiteId, logsPath, testInfo }, use);
	}, { auto: true }],

	tracing: [async ({ app }, use, testInfo) => {
		const tracingFixture = TracingFixture();
		await tracingFixture({ app, testInfo }, use);
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

	metric: [async ({ logger, app }, use) => {
		const metricsRecorder = MetricsFixture(app, logger);
		await use(metricsRecorder);
	}, { scope: 'test' }],

	cleanup: async ({ app }: any, use: (arg0: TestTeardown) => any) => {
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
	setSpecName(testInfo.titlePath[0]);
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
export { TestTags as tags, WorkerFixtures };

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
	metric: RecordMetric;
}

interface WorkerFixtures {
	suiteId: string;
	snapshots: boolean;
	artifactDir: string;
	options: ApplicationOptions;
	userDataDir: string;
	app: Application;
	logsPath: string;
	logger: MultiLogger;
	settings: {
		set: (settings: Record<string, unknown>, options?: { reload?: boolean | 'web'; waitMs?: number; waitForReady?: boolean; keepOpen?: boolean }) => Promise<void>;
		clear: () => Promise<void>;
		remove: (settingsToRemove: string[]) => Promise<void>;
	};
	vsCodeSettings: VscodeSettings;
}
