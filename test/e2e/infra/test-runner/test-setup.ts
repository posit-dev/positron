/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { join } from 'path';
const rimraf = require('rimraf');
const mkdirp = require('mkdirp');
import { getBuildElectronPath, getDevElectronPath, Logger } from '../../infra';
import { createLogger } from './logger';
import * as os from 'os';

const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
const WEB = process.env.WEB;
const REMOTE = process.env.REMOTE;
const BUILD = process.env.BUILD;

/**
 * Prepares the test environment for Electron or E2E Web tests.
 *   1. creates logger instance `test-setup`
 *   2. initializes the test environment
 *   3. prepares the test data directory
 */
export function prepareTestEnv(rootPath: string, logsRootPath: string) {
	const logger = createLogger(logsRootPath, 'prepare-test-env.log');

	try {
		initializeTestEnvironment(rootPath, logger);
		console.log('✓ Test environment ready');

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
 * Sets up the test environment for Electron or Web e2e tests.
 */
function initializeTestEnvironment(rootPath = process.env.ROOT_PATH || 'ROOT_PATH not set initTestEnv', logger: Logger): PositronVersion | null {
	let version: PositronVersion | null = null;

	//
	// #### E2E: Electron Tests ####
	//

	if (!WEB) {
		let testCodePath = BUILD;
		let electronPath;

		if (testCodePath) {
			electronPath = getBuildElectronPath(testCodePath);
			version = getPositronVersion(testCodePath);
			if (version) {
				console.log(`POSITRON VERSION: ${version.positronVersion}-${version.buildNumber}`);
			}
		} else {
			testCodePath = getDevElectronPath();
			electronPath = testCodePath;
			process.env.VSCODE_REPOSITORY = rootPath;
			process.env.VSCODE_DEV = '1';
			process.env.VSCODE_CLI = '1';
		}

		if (REMOTE) {
			logger.log(`Running desktop E2E Remote tests against ${electronPath}`);
		} else {
			logger.log(`Running E2E Desktop tests against ${electronPath}`);
		}
	}

	//
	// #### Web E2E Tests ####
	//
	else {
		const testCodeServerPath = BUILD || process.env.VSCODE_REMOTE_SERVER_PATH;

		if (typeof testCodeServerPath === 'string') {
			if (!fs.existsSync(testCodeServerPath)) {
				throw new Error(`Cannot find Code server at ${testCodeServerPath}.`);
			} else {
				logger.log(`Running E2E Web tests against ${testCodeServerPath}`);
			}
		}

		if (!testCodeServerPath) {
			process.env.VSCODE_REPOSITORY = rootPath;
			process.env.VSCODE_DEV = '1';
			process.env.VSCODE_CLI = '1';

			logger.log(`Running E2E Web out of sources`);
		}
	}
	return version;
}

/**
 * Cleans and prepares the test data directory.
 */
function prepareTestDataDirectory() {
	// skipping deletion if running in CI because extensions setup case needs to be able to leave behind its extensions
	if (!process.env.CI && fs.existsSync(TEST_DATA_PATH)) {
		rimraf.sync(TEST_DATA_PATH);
	}
	mkdirp.sync(TEST_DATA_PATH);
}

export function getPositronVersion(testCodePath = process.env.BUILD || ''): PositronVersion | null {
	if (!testCodePath) {
		return null;
	}

	let productJsonPath;
	switch (process.platform) {
		case 'darwin':
			productJsonPath = join(testCodePath, 'Contents', 'Resources', 'app', 'product.json');
			break;
		case 'linux':
			productJsonPath = join(testCodePath, 'resources', 'app', 'product.json');
			break;
		case 'win32':
			productJsonPath = join(testCodePath, 'resources', 'app', 'product.json');
			break;
		default:
			return null;
	}

	try {
		// Read and parse the JSON file
		const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));

		// Return both version and build number properties
		const positronVersion = productJson.positronVersion || null;
		const buildNumber = productJson.positronBuildNumber || null;

		if (!positronVersion) {
			throw new Error('positronVersion not found in product.json.');
		}

		if (!buildNumber) {
			console.error('positronBuildNumber not found in product.json.');
		}

		return { positronVersion, buildNumber };
	} catch (error) {
		console.error('Error reading product.json:', error);
		return null;
	}
}

type PositronVersion = { positronVersion: string | null; buildNumber: string | null };
