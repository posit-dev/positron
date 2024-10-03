/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

// Node.js core modules
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const path = require('path');
const { join } = require('path');

// Third-party modules
const Mocha = require('mocha');
const minimist = require('minimist');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const vscodetest = require('@vscode/test-electron');

// Constants
const REPORT_PATH = join(process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || '', 'test-results/xunit-results.xml');
const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
const WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');
const EXTENSIONS_PATH = join(TEST_DATA_PATH, 'extensions-dir');

// Set environment variables based on options
// NOTE: Must be set before importing internal modules
const OPTS = minimist(process.argv.slice(2));
configureEnvVarsFromOptions(OPTS);

// Internal modules
const { createLogger, ROOT_PATH } = require('../out/positronUtils');
const { retry } = require('../out/utils');
const { getBuildVersion, measureAndLog, getBuildElectronPath, getDevElectronPath } = require('../../automation/out');

// Define a logger instance for `test-setup`
const logsRootPath = path.join(ROOT_PATH, '.build', 'logs', 'test-setup');
const logger = createLogger(logsRootPath);
let version;

// Main execution flow
(async function main() {
	await prepareTestEnv();
	cloneTestRepo();
	runMochaTests();
})();

/**
 * Prepares the test environment for Electron or Web smoke tests.
 */
async function prepareTestEnv() {
	try {
		initializeTestEnvironment(logger);
		console.log('Test environment setup completed successfully.');

		// Disabling this section of code for now. It's used to download a stable version of VSCode
		// I'm guessing we would want to update this to download a stable version of Positron
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
 * Runs Mocha tests.
 */
function runMochaTests() {
	const mocha = new Mocha({
		color: true,
		timeout: 1 * 60 * 1000,  // 1 minute
		slow: 30 * 1000,         // 30 seconds
		grep: OPTS['f'] || OPTS['g'],
		parallel: OPTS['parallel'],
		jobs: OPTS['jobs'],
		reporter: 'mocha-multi',
		reporterOptions: {
			spec: '-',  // Console output
			xunit: REPORT_PATH,
		},
		retries: 0,
	});

	// Apply test filters based on CLI options
	applyTestFilters(mocha);

	// Add test files to the Mocha runner
	const testFiles = findTestFilesRecursive(path.resolve('out/areas/positron'));
	testFiles.forEach(file => mocha.addFile(file));

	// Run the Mocha tests
	mocha.run(failures => {
		if (failures) {
			console.log(getFailureLogs());
		} else {
			console.log('All tests passed.');
		}
		cleanupTestData(err => {
			if (err) {
				console.log('Error cleaning up test data:', err);
			} else {
				process.exit(failures ? 1 : 0);
			}
		});
	});
}

/**
 * Applies test filters based on environment variables.
 */
function applyTestFilters(mocha) {
	// TODO: see if it's possible to use multiple filters
	if (process.env.WEB) {
		mocha.grep(/#web/);
	}
	else if (process.env.WIN) {
		mocha.grep(/#win/);
	}
	else if (process.env.PR) {
		mocha.grep(/#pr/);
	} else if (process.env.INVERSE_FILTER) {
		mocha.grep(process.env.INVERSE_FILTER).invert();
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

/**
 * Clones or copies the test repository based on options.
 */
function cloneTestRepo() {
	const testRepoUrl = 'https://github.com/posit-dev/qa-example-content.git';

	if (OPTS['test-repo']) {
		console.log('Copying test project repository from:', OPTS['test-repo']);
		// Remove the existing workspace path if the option is provided
		rimraf.sync(WORKSPACE_PATH);

		// Copy the repository based on the platform (Windows vs. non-Windows)
		if (process.platform === 'win32') {
			cp.execSync(`xcopy /E "${OPTS['test-repo']}" "${WORKSPACE_PATH}\\*"`);
		} else {
			cp.execSync(`cp -R "${OPTS['test-repo']}" "${WORKSPACE_PATH}"`);
		}
	} else {
		// If no test-repo is specified, clone the repository if it doesn't exist
		if (!fs.existsSync(WORKSPACE_PATH)) {
			console.log('Cloning test project repository from:', testRepoUrl);
			const res = cp.spawnSync('git', ['clone', testRepoUrl, WORKSPACE_PATH], { stdio: 'inherit' });

			// Check if cloning failed by verifying if the workspacePath was created
			if (!fs.existsSync(WORKSPACE_PATH)) {
				throw new Error(`Clone operation failed: ${res.stderr?.toString()}`);
			}
		} else {
			console.log('Cleaning and updating test project repository...');
			// Fetch the latest changes, reset to the latest commit, and clean the repo
			cp.spawnSync('git', ['fetch'], { cwd: WORKSPACE_PATH, stdio: 'inherit' });
			cp.spawnSync('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: WORKSPACE_PATH, stdio: 'inherit' });
			cp.spawnSync('git', ['clean', '-xdf'], { cwd: WORKSPACE_PATH, stdio: 'inherit' });
		}
	}
}

/**
 * Returns formatted failure log messages.
 */
function getFailureLogs() {
	const rootPath = join(__dirname, '..', '..', '..');
	const logPath = join(rootPath, '.build', 'logs');

	if (process.env.BUILD_ARTIFACTSTAGINGDIRECTORY) {
		return `
###################################################################
#                                                                 #
# Logs are attached as build artefact and can be downloaded       #
# from the build Summary page (Summary -> Related -> N published) #
#                                                                 #
# Show playwright traces on: https://trace.playwright.dev/        #
#                                                                 #
###################################################################
		`;
	} else {
		return `
#############################################
#
# Log files of client & server are stored into
# '${logPath}'.
#
# Logs of the smoke test runner are stored into
# 'smoke-test-runner.log' in respective folder.
#
#############################################
		`;
	}
}

/**
 * Recursively finds all test files in child directories.
 */
function findTestFilesRecursive(dirPath) {
	let testFiles = [];
	const entries = fs.readdirSync(dirPath, { withFileTypes: true });

	entries.forEach(entry => {
		const fullPath = path.join(dirPath, entry.name);
		if (entry.isDirectory()) {
			// If it's a directory, recursively search within it
			testFiles = testFiles.concat(findTestFilesRecursive(fullPath));
		} else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.startsWith('example.test.js')) {
			// If it's a file, add it if it matches the criteria
			testFiles.push(fullPath);
		}
	});

	return testFiles;
}

/**
 * Cleans up the test data directory.
 */
function cleanupTestData(callback) {
	if (process.env.SKIP_CLEANUP) {
		callback(null);
	} else {
		rimraf(TEST_DATA_PATH, { maxBusyTries: 10 }, error => {
			if (error) {
				console.error('Error cleaning up test data:', error);
				return callback(error);
			}
			console.log('Test data cleaned up successfully.');
			callback(null);
		});
	}
}

/**
 * Parses the version string into its major, minor, and patch components.
 */
function parseVersion(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
	if (!match) {
		throw new Error(`Invalid version format: ${version}`);
	}
	const [, major, minor, patch] = match;
	return { major: parseInt(major), minor: parseInt(minor), patch: parseInt(patch) };
}

/**
 * Ensures a stable version of VSCode is downloaded if not already available.
 */
async function ensureStableCode(testDataPath, logger, opts) {
	let stableCodePath = opts['stable-build'];

	// Ensure that the `vscsmoke` folder exists before proceeding
	mkdirp.sync(testDataPath);

	if (!stableCodePath) {
		const current = parseVersion(version);  // Use version declared in main
		const versionsReq = await retry(() => measureAndLog(() => fetch('https://update.code.visualstudio.com/api/releases/stable'), 'versionReq', logger), 1000, 20);

		if (!versionsReq.ok) {
			throw new Error('Could not fetch releases from update server');
		}

		const versions = await measureAndLog(() => versionsReq.json(), 'versionReq.json()', logger);
		const stableVersion = versions.find(raw => {
			const version = parseVersion(raw);
			return version.major < current.major || (version.major === current.major && version.minor < current.minor);
		});

		if (!stableVersion) {
			throw new Error(`Could not find suitable stable version for ${version}`);
		}

		logger.log(`Found VS Code v${version}, downloading previous VS Code version ${stableVersion}...`);

		const stableCodeDestination = path.join(testDataPath, 's');
		const stableCodeExecutable = await retry(() => measureAndLog(() => vscodetest.download({
			cachePath: stableCodeDestination,
			version: stableVersion,
			extractSync: true,
		}), 'download stable code', logger), 1000, 3);

		stableCodePath = path.dirname(stableCodeExecutable);
	}

	if (!fs.existsSync(stableCodePath)) {
		throw new Error(`Cannot find Stable VSCode at ${stableCodePath}.`);
	}

	logger.log(`Using stable build ${stableCodePath} for migration tests`);
	opts['stable-build'] = stableCodePath;
}

/**
 * Sets up the test environment for Electron or Web smoke tests.
 */
function initializeTestEnvironment(logger) {
	//
	// #### Electron Smoke Tests ####
	//

	if (!OPTS.web) {
		let testCodePath = OPTS.build;
		let electronPath;

		if (testCodePath) {
			electronPath = getBuildElectronPath(testCodePath);
			version = getBuildVersion(testCodePath);
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

		if (OPTS.remote) {
			logger.log(`Running desktop remote smoke tests against ${electronPath}`);
		} else {
			logger.log(`Running desktop smoke tests against ${electronPath}`);
		}
	}

	//
	// #### Web Smoke Tests ####
	//
	else {
		const testCodeServerPath = OPTS.build || process.env.VSCODE_REMOTE_SERVER_PATH;

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
 * Configures environment variables based on parsed options.
 */
function configureEnvVarsFromOptions(opts) {
	const envVars = {
		BUILD: opts['build'] || '',
		HEADLESS: opts['headless'] || '',
		PARALLEL: opts['parallel'] || '',
		REMOTE: opts['remote'] || '',
		TRACING: opts['tracing'] || '',
		VERBOSE: opts['verbose'] || '',
		WEB: opts['web'] || '',
		WIN: opts['win'] || '',
		PR: opts['pr'] || '',
		SKIP_CLEANUP: opts['skip-cleanup'] || '',
		EXTENSIONS_PATH: EXTENSIONS_PATH,
		WORKSPACE_PATH: WORKSPACE_PATH,
		TEST_DATA_PATH: TEST_DATA_PATH,
		REPORT_PATH: REPORT_PATH,
	};
	Object.assign(process.env, envVars);
}
