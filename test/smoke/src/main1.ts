/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as os from 'os';
import * as rimraf from 'rimraf';
import * as mkdirp from 'mkdirp';
import { Quality, measureAndLog } from '../../automation';
import { timeout } from './utils';
import { setup as setupQuartoTest } from './areas/positron/quarto/quarto.test';
import { createLogger, ensureStableCode, parseOptions, runSmokeTests, setupRepository } from './setupUtils';

const suiteName = 'Suite 1';
const rootPath = path.join(__dirname, '..', '..', '..');
const testDataPath = path.join(os.tmpdir(), `vscsmoke_${suiteName}`);
const logsRootPath = path.join(rootPath, '.build', 'logs', 'smoke-tests-electron');
const crashesRootPath = path.join(rootPath, '.build', 'crashes', 'smoke-tests-electron');
const workspacePath = path.join(testDataPath, 'qa-example-content');
const extensionsPath = path.join(testDataPath, 'extensions-dir');

mkdirp.sync(logsRootPath);
mkdirp.sync(testDataPath);

const opts = parseOptions();
const logger = createLogger(opts, logsRootPath);
let version: string | undefined;

// Define the global setup function
async function setup(): Promise<Quality> {
	if (!opts.web && !opts.remote && opts.build) {
		// only enabled when running with --build and not in web or remote
		await measureAndLog(() => ensureStableCode(testDataPath, version, logger, opts), 'ensureStableCode', logger);
	}

	await measureAndLog(() => setupRepository(workspacePath, logger, opts), 'setupRepository', logger);

	console.log(`${suiteName} setup done`);

	return quality;
}

// Run smoke tests (either Electron or Web)
const quality = runSmokeTests(logger, opts, rootPath, version);

// Before all tests run setup
before(async function () {
	this.timeout(5 * 60 * 1000); // increase since we download VSCode

	const quality = await setup();

	this.defaultOptions = {
		quality,
		codePath: opts.build,
		workspacePath,
		userDataDir: path.join(testDataPath, 'd'),
		extensionsPath,
		logger,
		logsPath: path.join(logsRootPath, 'suite_unknown'),
		crashesPath: path.join(crashesRootPath, 'suite_unknown'),
		verbose: opts.verbose,
		remote: opts.remote,
		web: opts.web,
		tracing: opts.tracing,
		headless: opts.headless,
		browser: opts.browser,
		extraArgs: (opts.electronArgs || '').split(' ').map(arg => arg.trim()).filter(arg => !!arg)
	};

	await setup();
});

// After main suite (after all tests)
after(async function () {
	try {
		let deleted = false;
		await measureAndLog(() => Promise.race([
			new Promise<void>((resolve, reject) => rimraf(testDataPath, { maxBusyTries: 10 }, error => {
				if (error) {
					reject(error);
				} else {
					deleted = true;
					resolve();
				}
			})),
			timeout(30000).then(() => {
				if (!deleted) {
					throw new Error('giving up after 30s');
				}
			})
		]), 'rimraf(testDataPath)', logger);
	} catch (error) {
		logger.log(`Unable to delete smoke test workspace: ${error}. This indicates some process is locking the workspace folder.`);
	}
});

describe(`VSCode Smoke Tests (${opts.web ? 'Web' : 'Electron'})`, () => {
	setupQuartoTest(logger);
});
