/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Playwright and testing imports
import { _electron, test as base, expect } from '@playwright/test';

// Node.js built-in modules
import { join } from 'path';
import * as os from 'os';
import path = require('path');
const fs = require('fs-extra');

// Third-party packages
import minimist = require('minimist');

// Local project modules
import { createLogger } from '../test-runner/logger';
import { ROOT_PATH } from '../test-runner/test-hooks';
import { Application, Logger } from '../../../automation';
import { createApp } from '../utils';
import { cloneTestRepo, prepareTestEnv } from '../test-runner';

export const test = base.extend<{
	app: Application;
	reuseApp: boolean;
	defaultOptions: any;
	logger: Logger;
	tracing: any;
	page: any;
	context: any;
	attachScreenshotsToReport: any;
}>({
	defaultOptions: async ({ }, use) => {
		const LOGS_DIR = process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || 'smoke-tests-default';
		const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
		const EXTENSIONS_PATH = join(TEST_DATA_PATH, 'extensions-dir');
		const WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');
		const OPTS = minimist(process.argv.slice(2));

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
		prepareTestEnv();
		cloneTestRepo(WORKSPACE_PATH);

		await use(options);
	},

	reuseApp: [true, { option: true }],

	app: async ({ defaultOptions, reuseApp }, use) => {
		const app = createApp(defaultOptions);

		// Conditionally start the app based on reuseApp flag
		if (!reuseApp) {
			// Start and stop app for each test
			await app.start();
			await use(app);
			await app.stop();
		} else {
			// App lifecycle will be managed in beforeAll/afterAll
			await use(app);
		}
	},

	page: async ({ app }, use) => {
		await use(app.code.driver.getPage());
	},

	context: async ({ app }, use) => {
		await use(app.code.driver.getContext());
	},

	logger: async ({ defaultOptions }, use) => {
		await use(defaultOptions.logger);
	},

	tracing: [async ({ app }, use, testInfo) => {
		const driver = app.code.driver;
		const context = driver.getContext();

		// Start tracing
		await context.tracing.start({ screenshots: true, snapshots: true });

		// Execute the test
		await use();

		// Stop tracing and save trace to file
		const tracePath = testInfo.outputPath(`electron-trace${Date.now()}.zip`);
		await context.tracing.stop({ path: tracePath });

		// Attach the trace to the test report
		testInfo.attachments.push({ name: 'trace', path: tracePath, contentType: 'application/zip' });

	}, { auto: true }],

	attachScreenshotsToReport: [async ({ app }, use, testInfo) => {
		let screenShotCounter = 1;
		const page = app.code.driver.getPage();
		const screenshots: string[] = [];

		app.code.driver.takeScreenshot = async function (name: string) {
			const screenshotPath = testInfo.outputPath(`${screenShotCounter++}-${name}.png`);
			page.screenshot({ path: screenshotPath });
			screenshots.push(screenshotPath);
		};

		// Execute the test
		await use();

		// After the test we can check whether the test passed or failed.
		if (testInfo.status !== testInfo.expectedStatus) {
			const screenshot = await page.screenshot();
			await testInfo.attach('on-test-fail', { body: screenshot, contentType: 'image/png' });
		}

		for (const screenshotPath of screenshots) {
			console.log('Attaching screenshot:', screenshotPath);
			testInfo.attachments.push({ name: path.basename(screenshotPath), path: screenshotPath, contentType: 'image/png' });
		}

	}, { auto: true }],
});


test.beforeAll(async ({ app, reuseApp }) => {
	// If reuseApp is true, the app will be started in beforeAll
	console.log('beforeAll reuseApp:', reuseApp);
	if (reuseApp) {
		await app.start();
	}
});

test.afterAll(async ({ app, reuseApp }) => {
	// If reuseApp is true, the app will be stopped after all tests
	console.log('afterAll reuseApp:', reuseApp);
	if (reuseApp) {
		await app.stop();
	}
});

test.beforeEach(async ({ logger, app }) => {
	logger.log('>>> Test start <<<');
});

test.afterEach(async ({ logger, app }) => {
	logger.log('>>> Test end <<<');
});


// test('has title', async ({ app }) => {
// 	await app.workbench.quickaccess.openFile(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.qmd'));
// 	await app.code.driver.takeScreenshot('marie-screen');
// 	await renderQuartoDocument(app, 'html');
// 	await app.code.driver.takeScreenshot('marie-screen');
// 	await verifyDocumentExists(app, 'html');
// 	app.code.wait(5000);
// 	expect(1).toBe(2);
// });

// const renderQuartoDocument = async (app: Application, fileExtension: string) => {
// 	await app.workbench.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
// 	await app.workbench.quickinput.selectQuickInputElementContaining(fileExtension);
// };

// const verifyDocumentExists = async (app: Application, fileExtension: string) => {
// 	await expect(async () => {
// 		await app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes(`Output created: quarto_basic.${fileExtension}`)));
// 		expect(await fileExists(app, `quarto_basic.${fileExtension}`)).toBe(true);
// 	}).toPass();
// };

// const fileExists = (app: Application, file: String) => {
// 	const filePath = path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', file);
// 	return fs.pathExists(filePath);
// };
