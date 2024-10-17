/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Playwright and testing imports
import { _electron, test as base, expect } from '@playwright/test';
import * as playwright from '@playwright/test';

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
export const test = base.extend<{
	app: Application;
	application: playwright.Browser | playwright.ElectronApplication;
	reuseApp: boolean;
	defaultOptions: any;
	logger: Logger;
	tracing: any;
	page: playwright.Page;
	context: playwright.BrowserContext;
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
			tracing: true,
			headless: OPTS.headless,
			browser: OPTS.browser,
			extraArgs: (OPTS.electronArgs || '').split(' ').map(arg => arg.trim()).filter(arg => !!arg),
		};

		await use(options);
	},

	reuseApp: [true, { option: true }],

	// Application fixture
	app: async ({ defaultOptions, reuseApp }, use) => {
		// if (reuseApp && appInstance) {
		// 	console.log('Reusing the existing app instance');
		// 	// Reuse the existing app instance
		// 	await use(appInstance);
		// } else {
		// 	console.log('Creating a new app instance');
		// 	// Create a new app instance
		const app = createApp(defaultOptions);
		await app.start();
		await use(app);
		await app.stop();
		// }
	},

	page: async ({ app }, use) => {
		await use(app.code.driver.getPage());
	},

	context: async ({ app }, use) => {
		await use(app.code.driver.getContext());
	},

	attachScreenshotsToReport: [async ({ app }, use, testInfo) => {
		let screenShotCounter = 1;
		const page = app.code.driver.getPage();
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
			await testInfo.attach('on-test-fail', { body: screenshot, contentType: 'image/png' });
		}

		for (const screenshotPath of screenshots) {
			console.log('Attaching screenshot:', screenshotPath);
			testInfo.attachments.push({ name: path.basename(screenshotPath), path: screenshotPath, contentType: 'image/png' });
		}

	}, { auto: true }],

	tracing: [async ({ app }, use, testInfo) => {
		// Start tracing
		await app.startTracing('test');

		// Run the test
		await use(app);

		// Stop tracing
		const tracePath = testInfo.outputPath('trace.zip');
		await app.stopTracing('test', true, tracePath);
		testInfo.attachments.push({ name: 'trace', path: tracePath, contentType: 'application/zip' });
	}, { auto: true }],

	application: async ({ app }, use) => {
		await use(app.code.driver.getApplication());
	},

	logger: async ({ defaultOptions }, use) => {
		await use(defaultOptions.logger);
	},
});


test.describe.only('poc suite', () => {
	// test.use({ reuseApp: true });

	test('poc test 1', async ({ app }) => {
		await app.workbench.quickaccess.openFile(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.qmd'));
		await app.code.driver.takeScreenshot('screen 1');
		await renderQuartoDocument(app, 'html');
		expect(1).toBe(2);
	});

	test('poc test 2', async ({ app }) => {
		await app.workbench.quickaccess.openFile(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.qmd'));
		await app.code.driver.takeScreenshot('screen 2');
	});
});

const renderQuartoDocument = async (app: Application, fileExtension: string) => {
	await app.workbench.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
	await app.workbench.quickinput.selectQuickInputElementContaining(fileExtension);
};

const verifyDocumentExists = async (app: Application, fileExtension: string) => {
	await expect(async () => {
		await app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.includes(`Output created: quarto_basic.${fileExtension}`)));
		expect(await fileExists(app, `quarto_basic.${fileExtension}`)).toBe(true);
	}).toPass();
};

const fileExists = (app: Application, file: String) => {
	const filePath = path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', file);
	return fs.pathExists(filePath);
};
