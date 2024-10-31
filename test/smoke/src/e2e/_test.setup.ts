/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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

// Third-party packages
import minimist = require('minimist');
import { randomUUID } from 'crypto';
import archiver from 'archiver';

// Local imports
import { createLogger } from '../test-runner/logger';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../automation';
import { createApp } from '../utils';

const TEMP_DIR = `temp-${randomUUID()}`;
const ROOT_PATH = join(__dirname, '..', '..', '..', '..');
const LOGS_ROOT_PATH = join(ROOT_PATH, '.build', 'logs');

let SPEC_NAME = '';
let logsCounter = 1;

export const test = base.extend<{
	tracing: any;
	page: playwright.Page;
	context: playwright.BrowserContext;
	attachScreenshotsToReport: any;
	interpreter: { set: (interpreterName: 'Python' | 'R') => Promise<void> };
	restartApp: Application;
	testName: string;
	r: void;
	python: void;
	autoTestFixture: any;
	attachLogsToReport: any;
}, {
	suiteId: string;
	web: boolean;
	artifactDir: string;
	options: any;
	app: Application;
	logger: Logger;
	logsPath: string;
}>({

	suiteId: ['', { scope: 'worker', option: true }],

	web: [false, { scope: 'worker', option: true }],

	artifactDir: ['e2e-default', { scope: 'worker', option: true }],

	logsPath: [async ({ artifactDir }, use) => {
		const logsPath = join(LOGS_ROOT_PATH, artifactDir, TEMP_DIR);
		await use(logsPath);
	}, { scope: 'worker', auto: true }],

	logger: [async ({ logsPath }, use) => {
		const logger = createLogger(logsPath);
		await use(logger);
	}, { auto: true, scope: 'worker' }],

	options: [async ({ web, artifactDir, logsPath, logger }, use) => {
		const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
		const EXTENSIONS_PATH = join(TEST_DATA_PATH, 'extensions-dir');
		const WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');
		const SPEC_CRASHES_PATH = join(ROOT_PATH, '.build', 'crashes', artifactDir, TEMP_DIR);

		const options = {
			codePath: process.env.BUILD,
			workspacePath: WORKSPACE_PATH,
			userDataDir: join(TEST_DATA_PATH, 'd'),
			extensionsPath: EXTENSIONS_PATH,
			logger,
			logsPath,
			crashesPath: SPEC_CRASHES_PATH,
			verbose: process.env.VERBOSE,
			remote: process.env.REMOTE,
			web,
			tracing: true,
			headless: process.env.HEADLESS,
			browser: process.env.BROWSER,
			// extraArgs: (OPTS.electronArgs || '').split(' ').map(arg => arg.trim()).filter(arg => !!arg),
		};

		await use(options);
	}, { scope: 'worker', auto: true }],

	restartApp: [async ({ app }, use) => {
		await app.restart();
		await use(app);
	}, { scope: 'test', timeout: 60000 }],

	app: [async ({ options, logsPath }, use) => {
		const app = createApp(options);
		await app.start();
		await use(app);
		await app.stop();

		// rename the temp logs dir to the spec name
		const specLogsPath = logsPath.split('/').slice(0, -1).join('/') + '/' + SPEC_NAME;
		await moveAndOverwrite(logsPath, specLogsPath);
	}, { scope: 'worker', auto: true, timeout: 60000 }],

	interpreter: [async ({ app, page }, use) => {
		const setInterpreter = async (interpreterName: 'Python' | 'R') => {
			const currentInterpreter = await page.locator('.top-action-bar-interpreters-manager').textContent() || '';

			if (!currentInterpreter.includes(interpreterName)) {
				if (interpreterName === 'Python') {
					await PositronPythonFixtures.SetupFixtures(app);
				} else if (interpreterName === 'R') {
					await PositronRFixtures.SetupFixtures(app);
				}
			}
		};

		await use({ set: setInterpreter });
	}, { scope: 'test', }],

	r: [
		async ({ interpreter }, use) => {
			await interpreter.set('R');
			await use();
		},
		{ scope: 'test' }
	],

	python: [
		async ({ interpreter }, use) => {
			await interpreter.set('Python');
			await use();
		},
		{ scope: 'test' }],

	attachScreenshotsToReport: [async ({ app }, use, testInfo) => {
		let screenShotCounter = 1;
		const page = app.code.driver.page;
		const screenshots: string[] = [];

		app.code.driver.takeScreenshot = async function (name: string) {
			const screenshotPath = testInfo.outputPath(`${screenShotCounter++}-${name}.png`);
			page.screenshot({ path: screenshotPath });
			screenshots.push(screenshotPath);
		};

		await use();

		// if test failed, attach screenshot
		if (testInfo.status !== testInfo.expectedStatus) {
			const screenshot = await page.screenshot();
			await testInfo.attach('on-test-end', { body: screenshot, contentType: 'image/png' });
		}

		for (const screenshotPath of screenshots) {
			console.log('Attaching screenshot:', screenshotPath);
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
		await archive.finalize();

		// attach the zipped file to the report
		await testInfo.attach(`logs-${suiteId}-${logsCounter++}.zip`, {
			path: zipPath,
			contentType: 'application/zip',
		});

		// Clear the TEMP_LOGS_PATH directory
		// const files = await fs.promises.readdir(TEMP_LOGS_PATH);
		// for (const file of files) {
		// 	const filePath = path.join(TEMP_LOGS_PATH, file);
		// 	await fs.promises.rm(filePath, { recursive: true, force: true });
		// }
	}, { auto: true }],

	tracing: [async ({ app }, use, testInfo) => {
		// start tracing
		const title = (testInfo.title || 'unknown').replace(/\s+/g, '-');
		await app.startTracing(title);

		await use(app);

		// stop tracing
		const tracePath = testInfo.outputPath(`${title}_trace.zip`);
		await app.stopTracing(title, true, tracePath);
		testInfo.attachments.push({ name: 'trace', path: tracePath, contentType: 'application/zip' });

	}, { auto: true, scope: 'test' }],

	page: async ({ app }, use) => {
		await use(app.code.driver.page);
	},

	context: async ({ app }, use) => {
		await use(app.code.driver.context);
	},

	autoTestFixture: [async ({ logger, suiteId }, use, testInfo) => {
		// if (!suiteId) { throw new Error('suiteId is required'); }

		logger.log('');
		logger.log(`>>> Test start: '${testInfo.title ?? 'unknown'}' <<<`);
		logger.log('');

		await use();

		const failed = testInfo.status !== testInfo.expectedStatus;
		const testTitle = testInfo.title;
		const endLog = failed ? `>>> !!! FAILURE !!! Test end: '${testTitle}' !!! FAILURE !!! <<<` : `>>> Test end: '${testTitle}' <<<`;

		logger.log('');
		logger.log(endLog);
		logger.log('');
	}, { scope: 'test', auto: true }],
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
	logger.log('');
	logger.log(`>>> Suite end: '${testInfo.titlePath[0] ?? 'unknown'}' <<<`);
	logger.log('');
});

export { playwrightExpect as expect };

async function moveAndOverwrite(sourcePath: string, destinationPath: string) {
	try {
		// Check if the destination exists and delete it if so
		await access(destinationPath, constants.F_OK);
		await rm(destinationPath, { recursive: true, force: true });
	} catch {
		// If destination doesn't exist, continue without logging
	}
	// Ensure the parent directory of the destination exists
	await mkdir(path.dirname(destinationPath), { recursive: true });
	// Rename source to destination
	await rename(sourcePath, destinationPath);
}
