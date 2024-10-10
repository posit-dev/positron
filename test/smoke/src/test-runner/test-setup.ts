/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { join } from 'path';
const rimraf = require('rimraf');
const mkdirp = require('mkdirp');
import { getBuildElectronPath, getDevElectronPath, Logger } from '../../../automation';
import { createLogger } from './logger';

const ROOT_PATH = process.env.ROOT_PATH || 'ROOT_PATH not set';
const TEST_DATA_PATH = process.env.TEST_DATA_PATH || 'TEST_DATA_PATH not set';
const WEB = process.env.WEB;
const REMOTE = process.env.REMOTE;
const BUILD = process.env.BUILD;

/**
 * Prepares the test environment for Electron or Web smoke tests.
 *   1. creates logger instance `test-setup`
 *   2. initializes the test environment
 *   3. prepares the test data directory
 */
export function prepareTestEnv() {
	const logsRootPath = join(ROOT_PATH, '.build', 'logs', 'test-setup');
	const logger = createLogger(logsRootPath);

	try {
		initializeTestEnvironment(logger);
		console.log('Test environment setup completed successfully.');

		// Disabling this section of code for now. It's used to download a stable version of VSCode
		// Maybe we would want to update this to download a stable version of Positron some day?
		// if (!OPTS.web && !OPTS.remote && OPTS.build) {
		// 	// Only enabled when running with --build and not in web or remote
		// 	version = getBuildVersion(OPTS.build);
		// 	await ensureStableCode(TEST_DATA_PATH, logger, OPTS);
		// }

		prepareTestDataDirectory();
	} catch (error) {
		console.error('Failed to set up the test environment:', error);
		process.exit(1);
	}
}

/**
 * Sets up the test environment for Electron or Web smoke tests.
 */
function initializeTestEnvironment(logger: Logger) {

	//
	// #### Electron Smoke Tests ####
	//

	if (!WEB) {
		let testCodePath = BUILD;
		let electronPath;

		if (testCodePath) {
			electronPath = getBuildElectronPath(testCodePath);
		} else {
			testCodePath = getDevElectronPath();
			electronPath = testCodePath;
			process.env.VSCODE_REPOSITORY = ROOT_PATH;
			process.env.VSCODE_DEV = '1';
			process.env.VSCODE_CLI = '1';
		}

		if (!fs.existsSync(electronPath || '')) {
			throw new Error(`Cannot find VSCode at ${electronPath}. Please run VSCode once first (scripts/code.sh, scripts\\code.bat) and try again.`);
		}

		if (REMOTE) {
			logger.log(`Running desktop remote smoke tests against ${electronPath}`);
		} else {
			logger.log(`Running desktop smoke tests against ${electronPath}`);
		}
	}

	//
	// #### Web Smoke Tests ####
	//
	else {
		const testCodeServerPath = BUILD || process.env.VSCODE_REMOTE_SERVER_PATH;

		if (typeof testCodeServerPath === 'string') {
			if (!fs.existsSync(testCodeServerPath)) {
				throw new Error(`Cannot find Code server at ${testCodeServerPath}.`);
			} else {
				logger.log(`Running web smoke tests against ${testCodeServerPath}`);
			}
		}

		if (!testCodeServerPath) {
			process.env.VSCODE_REPOSITORY = ROOT_PATH;
			process.env.VSCODE_DEV = '1';
			process.env.VSCODE_CLI = '1';

			logger.log(`Running web smoke out of sources`);
		}
	}
}

/**
 * Cleans and prepares the test data directory.
 */
function prepareTestDataDirectory() {
	if (fs.existsSync(TEST_DATA_PATH)) {
		rimraf.sync(TEST_DATA_PATH);
	}
	mkdirp.sync(TEST_DATA_PATH);
}
