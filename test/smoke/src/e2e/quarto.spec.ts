// /*---------------------------------------------------------------------------------------------
//  *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
//  *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
//  *--------------------------------------------------------------------------------------------*/

// require('../../../smoke/src/test-runner/config');
// import { expect, test } from '@playwright/test';
// import { Application, Logger, } from '../../../automation';
// import { asBoolean, ParseOptions, } from '../test-runner/test-hooks';
// // import { createApp, } from '../utils';
// import { createLogger } from '../test-runner/logger';


// import * as path from 'path';
// import * as os from 'os';
// import minimist = require('minimist');

// const TEST_DATA_PATH = path.join(os.tmpdir(), 'vscsmoke');
// export const OPTS = minimist(process.argv.slice(2));

// const ROOT_PATH = process.env.ROOT_PATH as string;
// const WORKSPACE_PATH = process.env.WORKSPACE_PATH as string;
// const EXTENSIONS_PATH = process.env.EXTENSIONS_PATH as string;
// const LOGS_DIR = process.env.LOGS_DIR as string;

// const file = path.basename(__filename);
// const logsRootPath = path.join(ROOT_PATH, '.build', 'logs', LOGS_DIR, file);
// const crashesRootPath = path.join(ROOT_PATH, '.build', 'crashes', LOGS_DIR, file);
// const parseOptions: ParseOptions = {
// 	tracing: asBoolean(process.env.TRACING),
// 	parallel: asBoolean(process.env.PARALLEL),
// 	web: asBoolean(process.env.WEB),
// 	build: process.env.BUILD,
// 	remote: asBoolean(process.env.REMOTE),
// 	verbose: asBoolean(process.env.VERBOSE),
// 	headless: asBoolean(process.env.HEADLESS),
// 	browser: process.env.BROWSER,
// 	electronArgs: process.env.ELECTRON_ARGS,
// 	version: process.env.BUILD_VERSION,
// };

// // console.log('***** parseOptions', parseOptions);

// test.describe('Quarto #web', () => {
// 	let defaultOptions;
// 	// let app: Application;
// 	const logger = createLogger(logsRootPath);

// 	// Before all tests in this suite
// 	test.beforeAll(async () => {
// 		defaultOptions = {
// 			codePath: parseOptions.build,
// 			workspacePath: WORKSPACE_PATH,
// 			userDataDir: path.join(TEST_DATA_PATH, 'd'),
// 			extensionsPath: EXTENSIONS_PATH,
// 			logger,
// 			logsPath: path.join(logsRootPath),
// 			crashesPath: path.join(crashesRootPath),
// 			verbose: parseOptions.verbose,
// 			remote: parseOptions.remote,
// 			web: parseOptions.web,
// 			tracing: parseOptions.tracing,
// 			headless: false,
// 			browser: parseOptions.browser as 'chromium' | 'webkit' | 'firefox' | undefined,
// 			extraArgs: (parseOptions.electronArgs || '').split(' ').map(arg => arg.trim()).filter(arg => !!arg),
// 		};
// 		console.log(' ^^^^^ ');
// 		console.log(defaultOptions);

// 		// Initialize the app
// 		// app = createApp();
// 		// await app.start();
// 	});

// 	// After all tests in this suite
// 	// test.afterAll(async () => {
// 	// 	if (app) {
// 	// 		await app.stop();
// 	// 	}
// 	// });

// 	test('some test', async () => {
// 		expect(true).toBeTruthy();
// 	});


// 	// before(async function () {
// 	// 	app = this.app as Application;
// 	// 	await app.workbench.quickaccess.openFile(path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', 'quarto_basic.qmd'));
// 	// });

// 	// afterEach(async function () {
// 	// 	await deleteGeneratedFiles(app);
// 	// });

// 	// test('should be able to render html [C842847]', async function () {
// 	// 	await renderQuartoDocument(app, 'html');
// 	// 	await verifyDocumentExists(app, 'html');
// 	// });

// 	// test('should be able to render docx [C842848]', async function () {
// 	// 	await renderQuartoDocument(app, 'docx');
// 	// 	await verifyDocumentExists(app, 'docx');
// 	// });

// 	// test('should be able to render pdf (LaTeX) [C842890]', async function () {
// 	// 	await renderQuartoDocument(app, 'pdf');
// 	// 	await verifyDocumentExists(app, 'pdf');
// 	// });

// 	// test('should be able to render pdf (typst) [C842889]', async function () {
// 	// 	await renderQuartoDocument(app, 'typst');
// 	// 	await verifyDocumentExists(app, 'pdf');
// 	// });

// 	// test('should be able to generate preview [C842891]', async function () {
// 	// 	await app.workbench.quickaccess.runCommand('quarto.preview', { keepOpen: true });
// 	// 	const viewerFrame = app.workbench.positronViewer.getViewerFrame('//iframe');

// 	// 	// verify preview displays
// 	// 	expect(await viewerFrame.locator('h1').innerText()).toBe('Diamond sizes');
// 	// });
// });


// export function installDiagnosticsHandler(logger: Logger, appFn?: () => Application | undefined) {

// 	// Before each suite
// 	before(async function () {
// 		const suiteTitle = this.currentTest?.parent?.title;
// 		logger.log('');
// 		logger.log(`>>> Suite start: '${suiteTitle ?? 'unknown'}' <<<`);
// 		logger.log('');
// 	});

// 	// Before each test
// 	beforeEach(async function () {
// 		const testTitle = this.currentTest?.title;
// 		logger.log('');
// 		logger.log(`>>> Test start: '${testTitle ?? 'unknown'}' <<<`);
// 		logger.log('');

// 		const app: Application = appFn?.() ?? this.app;
// 		await app?.startTracing(testTitle ?? 'unknown');
// 	});

// 	// After each test
// 	afterEach(async function () {
// 		const currentTest = this.currentTest;
// 		if (!currentTest) {
// 			return;
// 		}

// 		const failed = currentTest.state === 'failed';
// 		const testTitle = currentTest.title;
// 		logger.log('');
// 		if (failed) {
// 			logger.log(`>>> !!! FAILURE !!! Test end: '${testTitle}' !!! FAILURE !!! <<<`);
// 		} else {
// 			logger.log(`>>> Test end: '${testTitle}' <<<`);
// 		}
// 		logger.log('');

// 		const app: Application = appFn?.() ?? this.app;
// 		// --- Start Positron ---
// 		// state is undefined during retry
// 		await app?.stopTracing(testTitle.replace(/[^a-z0-9\-]/ig, '_'), failed || (currentTest.state === undefined));
// 		// --- End Positron ---
// 	});
// }

// // function installAppBeforeHandler(optionsTransform?: (opts: ApplicationOptions) => ApplicationOptions) {
// // 	before(async function () {
// // 		const suiteName = this.test?.parent?.title ?? 'unknown';

// // 		this.app = createApp({
// // 			...this.defaultOptions,
// // 			logsPath: suiteLogsPath(this.defaultOptions, suiteName),
// // 			crashesPath: suiteCrashPath(this.defaultOptions, suiteName)
// // 		}, optionsTransform);
// // 		console.log('App created', this.app);
// // 		await this.app.start();
// // 	});
// // }

// // export function installAppAfterHandler(appFn?: () => Application | undefined, joinFn?: () => Promise<unknown>) {
// // 	after(async function () {
// // 		const app: Application = appFn?.() ?? this.app;
// // 		if (app) {
// // 			await app.stop();
// // 		}

// // 		if (joinFn) {
// // 			await joinFn();
// // 		}
// // 	});
// // }
