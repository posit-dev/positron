/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Standard library imports
import { join } from 'path';
import * as os from 'os';
import * as fs from 'fs';
// import * as cp from 'child_process';

// // External dependencies
// const rimraf = require('rimraf');
// const mkdirp = require('mkdirp');

// // Internal imports
// import { createLogger } from '../test-runner/logger';
// import { getBuildElectronPath, getDevElectronPath, Logger } from '../../../automation';
import { cloneTestRepo, prepareTestEnv } from '../test-runner';

// Constants for project paths
const ROOT_PATH = join(__dirname, '..', '..', '..', '..');
const LOGS_ROOT_PATH = join(ROOT_PATH, '.build', 'logs');
const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
const WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');

async function globalSetup() {
	fs.rmSync(LOGS_ROOT_PATH, { recursive: true, force: true });
	prepareTestEnv(ROOT_PATH);
	cloneTestRepo(WORKSPACE_PATH);
}

// /**
//  * Prepares the test environment for Electron or Web smoke tests.
//  *   1. creates logger instance `test-setup`
//  *   2. initializes the test environment
//  *   3. prepares the test data directory
//  */
// export function prepareTestEnv(rootPath) {
// 	const logsRootPath = join(rootPath, '.build', 'logs', 'test-setup');
// 	const logger = createLogger(logsRootPath);

// 	try {
// 		initializeTestEnvironment(rootPath, logger);
// 		console.log('Test environment setup completed successfully.');

// 		// Disabling this section of code for now. It's used to download a stable version of VSCode
// 		// Maybe we would want to update this to download a stable version of Positron some day?
// 		// if (!OPTS.web && !OPTS.remote && OPTS.build) {
// 		// 	// Only enabled when running with --build and not in web or remote
// 		// 	version = getBuildVersion(OPTS.build);
// 		// 	await ensureStableCode(TEST_DATA_PATH, logger, OPTS);
// 		// }

// 		prepareTestDataDirectory();
// 	} catch (error) {
// 		console.error('Failed to set up the test environment:', error);
// 		process.exit(1);
// 	}
// }


// /**
//  * Sets up the test environment for Electron or Web smoke tests.
//  */
// function initializeTestEnvironment(rootPath: string, logger: Logger): string | null {
// 	const WEB = process.env.WEB;
// 	const REMOTE = process.env.REMOTE;
// 	const BUILD = process.env.BUILD;
// 	let version: string | null = null;

// 	//
// 	// #### Electron Smoke Tests ####
// 	//

// 	if (!WEB) {
// 		let testCodePath = BUILD;
// 		let electronPath;

// 		if (testCodePath) {
// 			electronPath = getBuildElectronPath(testCodePath);
// 			version = getPositronVersion(testCodePath);
// 			console.log('POSITRON VERSION:', version);
// 		} else {
// 			testCodePath = getDevElectronPath();
// 			electronPath = testCodePath;
// 			process.env.VSCODE_REPOSITORY = rootPath;
// 			process.env.VSCODE_DEV = '1';
// 			process.env.VSCODE_CLI = '1';
// 		}

// 		if (!fs.existsSync(electronPath || '')) {
// 			throw new Error(`Cannot find VSCode at ${electronPath}. Please run VSCode once first (scripts/code.sh, scripts\\code.bat) and try again.`);
// 		}

// 		if (REMOTE) {
// 			logger.log(`Running desktop remote smoke tests against ${electronPath}`);
// 		} else {
// 			logger.log(`Running desktop smoke tests against ${electronPath}`);
// 		}
// 	}

// 	//
// 	// #### Web Smoke Tests ####
// 	//
// 	else {
// 		const testCodeServerPath = BUILD || process.env.VSCODE_REMOTE_SERVER_PATH;

// 		if (typeof testCodeServerPath === 'string') {
// 			if (!fs.existsSync(testCodeServerPath)) {
// 				throw new Error(`Cannot find Code server at ${testCodeServerPath}.`);
// 			} else {
// 				logger.log(`Running web smoke tests against ${testCodeServerPath}`);
// 			}
// 		}

// 		if (!testCodeServerPath) {
// 			process.env.VSCODE_REPOSITORY = rootPath;
// 			process.env.VSCODE_DEV = '1';
// 			process.env.VSCODE_CLI = '1';

// 			logger.log(`Running web smoke out of sources`);
// 		}
// 	}
// 	return version;
// }

// /**
//  * Cleans and prepares the test data directory.
//  */
// function prepareTestDataDirectory() {
// 	if (fs.existsSync(TEST_DATA_PATH)) {
// 		rimraf.sync(TEST_DATA_PATH);
// 	}
// 	mkdirp.sync(TEST_DATA_PATH);
// }

// function getPositronVersion(testCodePath: string): string | null {
// 	let productJsonPath;
// 	switch (process.platform) {
// 		case 'darwin':
// 			productJsonPath = join(testCodePath, 'Contents', 'Resources', 'app', 'product.json');
// 			break;
// 		case 'linux':
// 			productJsonPath = join(testCodePath, 'resources', 'app', 'product.json');
// 			break;
// 		case 'win32':
// 			productJsonPath = join(testCodePath, 'resources', 'app', 'product.json');
// 			break;
// 		default:
// 			return null;
// 	}

// 	// Read and parse the JSON file
// 	const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));

// 	// Return the `positronVersion` property if it exists, otherwise log an error
// 	if (productJson.positronVersion) {
// 		return productJson.positronVersion;
// 	} else {
// 		console.error('positronVersion not found in product.json.');
// 		return null;
// 	}
// }

// /**
//  * Clones or copies the test repository based on options.
//  */
// export function cloneTestRepo(workspacePath: string) {
// 	const TEST_REPO = process.env.TEST_REPO;
// 	const testRepoUrl = 'https://github.com/posit-dev/qa-example-content.git';

// 	if (TEST_REPO) {
// 		console.log('Copying test project repository from:', TEST_REPO);
// 		// Remove the existing workspace path if the option is provided
// 		rimraf.sync(workspacePath);

// 		// Copy the repository based on the platform (Windows vs. non-Windows)
// 		if (process.platform === 'win32') {
// 			cp.execSync(`xcopy /E "${TEST_REPO}" "${workspacePath}\\*"`);
// 		} else {
// 			cp.execSync(`cp -R "${TEST_REPO}" "${workspacePath}"`);
// 		}
// 	} else {
// 		// If no test-repo is specified, clone the repository if it doesn't exist
// 		if (!fs.existsSync(workspacePath)) {
// 			console.log('Cloning test project repository from:', testRepoUrl);
// 			const res = cp.spawnSync('git', ['clone', testRepoUrl, workspacePath], { stdio: 'inherit' });

// 			// Check if cloning failed by verifying if the workspacePath was created
// 			if (!fs.existsSync(workspacePath)) {
// 				throw new Error(`Clone operation failed: ${res.stderr?.toString()}`);
// 			}
// 		} else {
// 			console.log('Cleaning and updating test project repository...');
// 			// Fetch the latest changes, reset to the latest commit, and clean the repo
// 			cp.spawnSync('git', ['fetch'], { cwd: workspacePath, stdio: 'inherit' });
// 			cp.spawnSync('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: workspacePath, stdio: 'inherit' });
// 			cp.spawnSync('git', ['clean', '-xdf'], { cwd: workspacePath, stdio: 'inherit' });
// 		}
// 	}
// }

export default globalSetup;
