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

// Third-party packages
import minimist = require('minimist');

// Local imports
import { createLogger } from '../test-runner/logger';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../automation';
import { createApp } from '../utils';

const ROOT_PATH = join(__dirname, '..', '..', '..', '..');

export const test = base.extend<{
	logger: Logger;
	tracing: any;
	page: playwright.Page;
	context: playwright.BrowserContext;
	attachScreenshotsToReport: any;
	interpreter: { set: (interpreterName: 'Python' | 'R') => Promise<void> };
	rInterpreter: any;
	pythonInterpreter: any;
	restartApp: Application;
}, {
	web: boolean;
	options: any;
	app: Application;

}>({
	web: [false, { scope: 'worker', option: true }],

	options: [async ({ web }, use) => {
		const LOGS_DIR = process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || 'smoke-tests-default';
		const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
		const EXTENSIONS_PATH = join(TEST_DATA_PATH, 'extensions-dir');
		const WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');
		const OPTS = minimist(process.argv.slice(2));

		const suiteName = 'worker'; // Dynamic suite name logic here
		const logsRootPath = join(ROOT_PATH, '.build', 'logs', LOGS_DIR, suiteName);
		const crashesRootPath = join(ROOT_PATH, '.build', 'crashes', LOGS_DIR, suiteName);
		const logger = createLogger(logsRootPath);
		const options = {
			codePath: OPTS.build,
			workspacePath: WORKSPACE_PATH,
			userDataDir: join(TEST_DATA_PATH, 'd'),
			extensionsPath: EXTENSIONS_PATH,
			logger,
			logsPath: join(logsRootPath, 'options-fixture'),
			crashesPath: join(crashesRootPath, 'options-fixture'),
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

	app: [async ({ options }, use) => {
		const app = createApp(options);
		await app.start();
		await use(app);
		await app.stop();
	}, { scope: 'worker', auto: true, timeout: 60000 }],

	interpreter: [async ({ app, page }, use) => {
		const setInterpreter = async (interpreterName: 'Python' | 'R') => {
			const currentInterpreter = await page.locator('.top-action-bar-interpreters-manager').textContent() || '';


			// If current interpreter is not the requested one, switch it
			if (!currentInterpreter.includes(interpreterName)) {

				if (interpreterName === 'Python') {
					await PositronPythonFixtures.SetupFixtures(app);
					// console.log('Python interpreter started');
				} else if (interpreterName === 'R') {
					await PositronRFixtures.SetupFixtures(app); // Assuming PositronRFixtures is defined for R setup
					// console.log('R interpreter started');
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

		// After the test we can check whether the test passed or failed.
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
		// Start tracing
		const title = (testInfo.title || 'unknown').replace(/\s+/g, '-');
		await app.startTracing(title);

		// Run the test
		await use(app);

		// Stop tracing
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

	logger: [async ({ app }, use, testInfo) => {
		const LOGS_DIR = process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || 'smoke-tests-default';
		const suiteName = testInfo.titlePath[0];

		const logsRootPath = join(ROOT_PATH, '.build', 'logs', LOGS_DIR, suiteName);
		// const crashesRootPath = join(ROOT_PATH, '.build', 'crashes', LOGS_DIR, suiteName);
		const logger = createLogger(logsRootPath);

		app.setLogger(logger);

		// marie - add setLogger to application instance
		await use(logger);
	}, { auto: true, scope: 'test' }],

});

export { playwrightExpect as expect };
