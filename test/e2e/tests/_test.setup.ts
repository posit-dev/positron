/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Playwright and testing imports
import * as playwright from '@playwright/test';
const { test: base, expect: playwrightExpect } = playwright;

// Node.js built-in modules
import { join } from 'path';

// Local imports
import { Application, createLogger, TestTags, Sessions, HotKeys, TestTeardown, ApplicationOptions, MultiLogger, SettingsFile, USER_SETTINGS_FILENAME, getFreeMemory, getCondensedProcessList, getLoadAverageAndCpuUsage, Assistant } from '../infra';
import { PackageManager } from '../pages/utils/packageManager';
import {
	FileOperationsFixture, SettingsFixture, Settings, MetricsFixture,
	AttachScreenshotsToReportFixture, AttachLogsToReportFixture,
	TracingFixture, shouldUseCustomTracing, AppFixture, UserDataDirFixture, OptionsFixture,
	CustomTestOptions, TEMP_DIR, LOGS_ROOT_PATH, setSpecName, renameTempLogsDir
} from '../fixtures/test-setup';
import { loadEnvironmentVars, validateEnvironmentVars } from '../fixtures/load-environment-vars.js';
import { RecordMetric } from '../utils/metrics/metric-base.js';
import { runDockerCommand, RunResult, FOUNDRY_ASSISTANT_SETTINGS } from '../fixtures/test-setup/docker-utils.js';

// used specifically for app fixture error handling in test.afterAll
let appFixtureFailed = false;
let appFixtureScreenshot: Buffer | undefined;
let appFixtureTracePath: string | undefined;
let renamedLogsPath = 'not-set';

// Basename of the trace exported when the app fixture's `start()` fails (see the
// `app` fixture catch block); attached from the renamed logs dir in afterAll.
const APP_START_FAILURE_TRACE = 'app-start-failure-trace.zip';

// Test fixtures
export const test = base.extend<TestFixtures, WorkerFixtures>({
	suiteId: ['', { scope: 'worker', option: true }],

	managedCredentials: [undefined, { scope: 'worker', option: true }],

	useLegacyNotebookEditor: [false, { scope: 'worker', option: true }],

	enableDataConnections: [false, { scope: 'worker', option: true }],

	enableFoundryAssistant: [false, { scope: 'worker', option: true }],

	envVars: [async ({ }, use, workerInfo) => {
		const projectName = workerInfo.project.name;

		loadEnvironmentVars(projectName);

		validateEnvironmentVars([
			'POSITRON_PY_VER_SEL',
			'POSITRON_R_VER_SEL',
			'POSITRON_PY_ALT_VER_SEL',
			'POSITRON_R_ALT_VER_SEL',
		], { allowEmpty: false });

		if (projectName === 'e2e-workbench' || projectName === 'e2e-jupyter') {
			validateEnvironmentVars([
				'POSIT_WORKBENCH_PASSWORD'
			], { allowEmpty: false });
		}

		await use(projectName);
	}, { scope: 'worker', auto: true }],

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
		const options = await optionsFixture(logsPath, logger, snapshots, project, workerInfo);

		await use(options);
	}, { scope: 'worker', auto: true }],

	userDataDir: [async ({ options }, use, workerInfo) => {
		const projectName = workerInfo.project.name;

		if (['server', 'workbench'].includes(projectName)) {
			// For external/workbench projects, this fixture isn't used, they handle it separately
			await use('');
		} else {
			// Default case for e2e-electron, e2e-chromium, and other projects
			const userDataDirFixture = UserDataDirFixture();
			const userDir = await userDataDirFixture(options);
			await use(userDir);
		}
	}, { scope: 'worker', auto: true }],

	restartApp: [async ({ app }, use) => {
		await app.restart();
		await app.workbench.sessions.expectNoStartUpMessaging();

		await use(app);
	}, { scope: 'test', timeout: 60000 }],

	// placeholder for area-specific fixtures that need to run before app starts
	// e.g. changing settings that require an app reload
	beforeApp: [
		async ({ useLegacyNotebookEditor, enableDataConnections, enableFoundryAssistant, settingsFile }, use) => {
			if (useLegacyNotebookEditor) {
				// These tests exercise the legacy (VS Code) notebook editor. The
				// Positron notebook editor is now the default, so disable it before
				// the app starts to avoid waiting for a window reload. Suites opt in
				// with `test.use({ useLegacyNotebookEditor: true })`.
				await settingsFile.append({ 'positron.notebook.enabled': false });
			}

			if (enableDataConnections) {
				// The Data Connections panel is a preview feature gated behind this
				// setting, which requires a reload to take effect. Enable it before the
				// app starts so no reload is needed. Suites opt in with
				// `test.use({ enableDataConnections: true })`.
				await settingsFile.append({ 'databases.enabled': true });
			}

			if (enableFoundryAssistant) {
				// Enable the Microsoft Foundry (msFoundry) assistant provider before
				// the app starts so no reload is needed. Suites opt in with
				// `test.use({ enableFoundryAssistant: true })`. The Docker apps merge
				// the same settings via dockerSettingsOverrides.
				await settingsFile.append({ ...FOUNDRY_ASSISTANT_SETTINGS });
			}

			await use();
		},
		{ scope: 'worker' }],

	app: [async ({ options, logsPath, logger, managedCredentials, useLegacyNotebookEditor, enableDataConnections, enableFoundryAssistant, beforeApp: _beforeApp }, use, workerInfo) => {
		const { app, start, stop } = await AppFixture({ options, logsPath, logger, workerInfo, managedCredentials, useLegacyNotebookEditor, enableDataConnections, enableFoundryAssistant });

		try {
			// The first trace chunk is opened at context creation (see the driver's
			// `context.tracing.start` + `startChunk`), so the whole of `start()` --
			// server connect, sign-in, opening the workspace -- is recorded. Each
			// test's tracing fixture then exports the current chunk and opens the
			// next one (see TracingFixture).
			await start();

			await use(app);
		} catch (error) {
			appFixtureFailed = true;

			const screenshotPath = join(logsPath, 'app-start-failure.png');
			try {
				const page = app.code?.driver?.currentPage;
				if (page) {
					appFixtureScreenshot = await page.screenshot({ path: screenshotPath });
				}
			} catch {
				// ignore
			}

			// The per-test tracing fixture never runs when `start()` fails, so export
			// the startup chunk here. This is the trace of the failing startup itself.
			// It is written under logsPath, which `renameTempLogsDir` (below) renames,
			// so remember the basename and attach it from renamedLogsPath in afterAll.
			try {
				if (shouldUseCustomTracing(workerInfo.project)) {
					await app.stopTracing('app-start-failure', true, join(logsPath, APP_START_FAILURE_TRACE));
					appFixtureTracePath = APP_START_FAILURE_TRACE;
				}
			} catch {
				// ignore
			}

			throw error; // re-throw the error to ensure test failure
		} finally {
			await stop();
			renamedLogsPath = await renameTempLogsDir(logger, logsPath, workerInfo);
		}
		// Workbench projects sign in through Okta inside start(). That auth shares one TOTP
		// account across parallel shards, so a rejected/locked-out code triggers a jittered
		// backoff (see otpRetry.ts) of up to ~60s before re-submitting. 90s left no room for a
		// backoff to complete alongside OAuth navigation, so allow headroom for one retry.
	}, { scope: 'worker', auto: true, timeout: 180000 }],

	assistant: [
		async ({ app }, use) => {
			await use(app.workbench.assistant);
		},
		{ scope: 'test' }
	],

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

	// ex: await packages.manage('snowflake', 'install');
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

	// ex: await saveFileAs(path.join(app.workspacePathOrFolder, 'newfile.txt'));
	saveFileAs: async ({ app }, use) => {
		await use(async (filePath: string) => {
			const { quickaccess, quickInput } = app.workbench;
			await quickaccess.runCommand('workbench.action.files.saveAs', { keepOpen: true });
			await quickInput.waitForQuickInputOpened();
			await quickInput.type(filePath);
			await quickInput.clickOkButton();
		});
	},

	// ex: await runCommand('workbench.action.files.save');
	runCommand: async ({ app }, use) => {
		await use(async (command: string, options?: { keepOpen?: boolean; exactMatch?: boolean }) => {
			await app.workbench.quickaccess.runCommand(command, options);
		});
	},

	runDockerCommand: async ({ }, use, testInfo) => {
		await use(async (command: string, description: string) => {
			if (testInfo.project.name !== 'e2e-workbench' && testInfo.project.name !== 'e2e-jupyter' && testInfo.project.name !== 'e2e-remote-ssh') {
				throw new Error('runDockerCommand is only available in the e2e-workbench, e2e-jupyter & e2e-remote-ssh projects');
			}
			return runDockerCommand(command, description); // <-- return result
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

	// direct access to the settings file
	// e.g. to apply area-specific settings before the app start
	// see notebooks-positron/_test.setup.ts for example usage
	settingsFile: [async ({ userDataDir }, use) => {
		const manager = new SettingsFile(join(userDataDir, USER_SETTINGS_FILENAME));
		await manager.backupIfExists();
		await use(manager);
		await manager.restoreFromBackup();
	}, { scope: 'worker' }],

	vsCodeSettings: [async ({ }, use) => {
		const manager = new SettingsFile(SettingsFile.getVSCodeSettingsPath());
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
		await use(app.code.driver.currentPage);
	},

	autoTestFixture: [async ({ logger, suiteId, app }, use, testInfo) => {
		if (!suiteId) { throw new Error('suiteId is required'); }

		logger.log('');
		logger.log(`>>> Test start: '${testInfo.title ?? 'unknown'}' <<<`);
		logger.log('');

		await use();

		// Disabling for now to see if it improves teardown stability
		// await app.workbench.console.logConsoleContents();
		// await app.workbench.terminal.logTerminalContents();

		const failed = testInfo.status !== testInfo.expectedStatus;
		const testTitle = testInfo.title;
		const endLog = failed ? `>>> !!! FAILURE !!! Test end: '${testTitle}' !!! FAILURE !!! <<<` : `>>> Test end: '${testTitle}' <<<`;

		logger.log('');
		logger.log(endLog);
		logger.log('');

		// --- Start Positron ---
		// Log system diagnostics at end of each test for monitoring resource usage
		if (process.env.ENABLE_DIAGNOSTIC_LOGGING === 'true') {
			try {
				const freeMemory = getFreeMemory();
				const processList = getCondensedProcessList();
				const loadAvgAndCpu = getLoadAverageAndCpuUsage();
				console.log(`Free Memory: ${freeMemory}`);
				console.log(`Processes: ${processList}`);
				console.log(`${loadAvgAndCpu}`);
			} catch (error) {
				console.log(`Error logging system diagnostics: ${error}`);
			}
		}
		// --- End Positron ---
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

test.afterAll(async function ({ logger, suiteId, }, testInfo) {
	try {
		logger.log('');
		logger.log(`>>> Suite end: '${testInfo.titlePath[0] ?? 'unknown'}' <<<`);
		logger.log('');
	} catch (error) {
		// ignore
	}

	// Clean up Docker container logs at worker teardown (once per test file)
	const isWorkbenchProject = testInfo.project.name === 'e2e-workbench';
	if (isWorkbenchProject) {
		try {
			const { exec } = require('child_process');
			const { promisify } = require('util');
			const execP = promisify(exec);
			await execP('docker exec test sh -c "rm -rf /home/user1/.local/state/positron/logs/*"', {
				maxBuffer: 1024 * 1024 * 10,
			});
			console.log('Cleaned up logs in Docker container');
		} catch (err: any) {
			console.warn(`Failed to clean up logs in Docker container: ${err.message}`);
		}
	}

	if (appFixtureFailed) {
		try {
			if (appFixtureScreenshot) {
				await testInfo.attach('app-start-failure', {
					body: appFixtureScreenshot,
					contentType: 'image/png',
				});
			}
		} catch (e) {
			console.log(e);
		}

		try {
			if (appFixtureTracePath) {
				testInfo.attachments.push({
					name: 'trace',
					path: join(renamedLogsPath, appFixtureTracePath),
					contentType: 'application/zip',
				});
			}
		} catch (e) {
			console.log(e);
		}

		try {
			const attachLogs = AttachLogsToReportFixture();
			await attachLogs({ suiteId, logsPath: renamedLogsPath, testInfo }, async () => { /* no-op */ });
		} catch (e) {
			console.log(e);
		}

		appFixtureFailed = false;
		appFixtureScreenshot = undefined;
		appFixtureTracePath = undefined;
	}

	// Dump active handles/requests to help debug worker teardown timeouts
	// Enable with ENABLE_DIAGNOSTIC_LOGGING=true
	if (process.env.ENABLE_DIAGNOSTIC_LOGGING === 'true') {
		try {
			const util = require('util');

			function summarizeHandle(h: any) {
				const name = h?.constructor?.name ?? typeof h;

				if (name === 'ChildProcess') {
					return {
						type: name,
						pid: h.pid,
						spawnfile: h.spawnfile,
						spawnargs: h.spawnargs,
						connected: h.connected,
						killed: h.killed,
						exitCode: h.exitCode,
						signalCode: h.signalCode,
					};
				}

				if (name === 'Socket') {
					return {
						type: name,
						local: `${h.localAddress ?? ''}:${h.localPort ?? ''}`,
						remote: `${h.remoteAddress ?? ''}:${h.remotePort ?? ''}`,
						bytesWritten: h.bytesWritten,
						bytesRead: h.bytesRead,
						destroyed: h.destroyed,
						pending: h.pending,
					};
				}

				if (name === 'Pipe') {
					return {
						type: name,
						fd: h.fd,
					};
				}

				// default: show a shallow inspection
				return {
					type: name,
					info: util.inspect(h, { depth: 1, maxArrayLength: 10 }),
				};
			}

			// eslint-disable-next-line local/code-no-any-casts
			const handles = (process as any)._getActiveHandles?.() ?? [];
			// eslint-disable-next-line local/code-no-any-casts
			const requests = (process as any)._getActiveRequests?.() ?? [];
			console.log(`\n[afterAll] Active handles=${handles.length} requests=${requests.length}`);

			for (const h of handles) {
				console.log(' handle:', summarizeHandle(h));
			}

			// Group requests by type for cleaner output
			const byType = new Map<string, number>();
			const writeWraps: any[] = [];
			for (const r of requests) {
				const t = r?.constructor?.name ?? typeof r;
				byType.set(t, (byType.get(t) ?? 0) + 1);

				// Collect WriteWrap samples for detailed inspection
				if (t === 'WriteWrap' && writeWraps.length < 3) {
					writeWraps.push(r);
				}
			}
			console.log(' requestsByType:', Object.fromEntries(byType));

			// Show detailed info for first few WriteWrap requests (the smoking gun)
			if (writeWraps.length > 0) {
				console.log(' WriteWrap samples (first 3):');
				for (const w of writeWraps) {
					try {
						const handleType = w.handle?.constructor?.name ?? 'unknown';
						const handleDestroyed = w.handle?.destroyed ?? 'unknown';
						console.log(`   - handle: ${handleType}, destroyed: ${handleDestroyed}`);
					} catch {
						console.log('   - (unable to inspect)');
					}
				}
			}
		} catch (error) {
			console.log(`Error dumping handles: ${error}`);
		}
	}

});

export { playwrightExpect as expect };
export { TestTags as tags };

export interface TestFixtures {
	restartApp: Application;
	tracing: any;
	page: playwright.Page;
	attachScreenshotsToReport: any;
	attachLogsToReport: any;
	sessions: Sessions;
	assistant: Assistant;
	r: void;
	python: void;
	packages: PackageManager;
	autoTestFixture: any;
	devTools: void;
	openFile: (filePath: string, waitForFocus?: boolean) => Promise<void>;
	openDataFile: (filePath: string) => Promise<void>;
	openFolder: (folderPath: string) => Promise<void>;
	saveFileAs: (filePath: string) => Promise<void>;
	runCommand: (command: string, options?: { keepOpen?: boolean; exactMatch?: boolean }) => Promise<void>;
	runDockerCommand: (command: string, description: string) => Promise<RunResult>;
	executeCode: (language: 'Python' | 'R', code: string, options?: {
		timeout?: number;
		waitForReady?: boolean;
		maximizeConsole?: boolean;
	}) => Promise<void>;
	hotKeys: HotKeys;
	cleanup: TestTeardown;
	metric: RecordMetric;
}

export interface WorkerFixtures {
	suiteId: string;
	managedCredentials: 'snowflake' | 'databricks' | 'azure' | undefined;
	useLegacyNotebookEditor: boolean;
	enableDataConnections: boolean;
	enableFoundryAssistant: boolean;
	envVars: string;
	snapshots: boolean;
	artifactDir: string;
	options: ApplicationOptions;
	userDataDir: string;
	beforeApp: void;
	app: Application;
	logsPath: string;
	logger: MultiLogger;
	settings: Settings;
	settingsFile: SettingsFile;
	vsCodeSettings: SettingsFile;
}

export { CustomTestOptions };
