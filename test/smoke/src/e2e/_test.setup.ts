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
import path = require('path');
// eslint-disable-next-line local/code-import-patterns
import { rename, rm, access, mkdir } from 'fs/promises';
import { constants } from 'fs';

// Third-party packages
import minimist = require('minimist');
import { randomUUID } from 'crypto';

// Local imports
import { createLogger } from '../test-runner/logger';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../automation';
import { createApp } from '../utils';

const TEMP_DIR = `temp-${randomUUID()}`;
const ROOT_PATH = join(__dirname, '..', '..', '..', '..');
const LOGS_ROOT_PATH = join(ROOT_PATH, '.build', 'logs');
const ARTIFACT_DIR = process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || 'smoke-tests-default';
const TEMP_LOGS_PATH = join(LOGS_ROOT_PATH, ARTIFACT_DIR, TEMP_DIR);
const SPEC_CRASHES_PATH = join(ROOT_PATH, '.build', 'crashes', ARTIFACT_DIR, TEMP_DIR);
let SPEC_NAME = '';

export const test = base.extend<{
	tracing: any;
	page: playwright.Page;
	context: playwright.BrowserContext;
	attachScreenshotsToReport: any;
	interpreter: { set: (interpreterName: 'Python' | 'R') => Promise<void> };
	restartApp: Application;
	testName: string;
	autoTestFixture: any;
}, {
	suiteId: string;
	web: boolean;
	options: any;
	app: Application;
	logger: Logger;
	autoWorkerFixture: any;
}>({

	suiteId: ['not specified', { scope: 'worker', option: true }],

	web: [false, { scope: 'worker', option: true }],

	logger: [async ({ }, use) => {
		const logger = createLogger(TEMP_LOGS_PATH);

		await use(logger);
	}, { auto: true, scope: 'worker' }],

	options: [async ({ web, logger }, use, workerInfo) => {
		const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
		const EXTENSIONS_PATH = join(TEST_DATA_PATH, 'extensions-dir');
		const WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');
		const OPTS = minimist(process.argv.slice(2));

		const options = {
			codePath: OPTS.build,
			workspacePath: WORKSPACE_PATH,
			userDataDir: join(TEST_DATA_PATH, 'd'),
			extensionsPath: EXTENSIONS_PATH,
			logger: logger,
			logsPath: TEMP_LOGS_PATH,
			crashesPath: SPEC_CRASHES_PATH,
			verbose: OPTS.verbose,
			remote: OPTS.remote,
			web,
			tracing: true,
			headless: OPTS.headless,
			browser: OPTS.browser,
			extraArgs: (OPTS.electronArgs || '').split(' ').map(arg => arg.trim()).filter(arg => !!arg),
		};

		await use(options);
	}, { scope: 'worker', auto: true }],

	restartApp: [async ({ app }, use) => {
		await app.restart();
		await use(app);
	}, { scope: 'test', timeout: 60000 }],

	app: [async ({ options, suiteId }, use) => {
		const app = createApp(options);
		await app.start();
		await use(app);
		await app.stop();

		const correctLogsPath = join(ROOT_PATH, '.build', 'logs', ARTIFACT_DIR, SPEC_NAME);
		await moveAndOverwrite(TEMP_LOGS_PATH, correctLogsPath);
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

	autoTestFixture: [async ({ logger }, use, testInfo) => {
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

	autoWorkerFixture: [async ({ app }, use) => {
		await app.restart();
		await use();
	}, { scope: 'worker' }],

});

test.beforeAll(async ({ logger }, testInfo) => {
	// to ensure logs are written to the correct folder when sharing the app instance across workers,
	// we store the spec name in a global variable since workers aren't aware of it directly. this lets us
	// rename the logs folder once the suite finishes. note: we intentionally restart workers per spec to
	// scope logs by spec and give each spec a fresh app instance.
	SPEC_NAME = testInfo.titlePath[0];
	logger.log('');
	logger.log(`>>> Suite start: '${testInfo.titlePath[0] ?? 'unknown'}' <<<`);
	logger.log('');
});

// test.beforeEach(async function ({ logger }, testInfo) {
// 	logger.log('');
// 	logger.log(`>>> Test start: '${testInfo.title ?? 'unknown'}' <<<`);
// 	logger.log('');
// });

// test.afterEach(async function ({ logger }, testInfo) {
// 	const failed = testInfo.status !== testInfo.expectedStatus;
// 	const testTitle = testInfo.title;

// 	logger.log('');
// 	if (failed) {
// 		logger.log(`>>> !!! FAILURE !!! Test end: '${testTitle}' !!! FAILURE !!! <<<`);
// 	} else {
// 		logger.log(`>>> Test end: '${testTitle}' <<<`);
// 	}
// 	logger.log('');
// });

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
