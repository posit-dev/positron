/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

// Node.js core modules
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { join } = require('path');

// Third-party modules
const Mocha = require('mocha');
const minimist = require('minimist');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');

// Constants
const REPORT_PATH = join(process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || '', 'test-results/xunit-results.xml');
const TEST_DATA_PATH = join(os.tmpdir(), 'vscsmoke');
const WORKSPACE_PATH = join(TEST_DATA_PATH, 'qa-example-content');
const EXTENSIONS_PATH = join(TEST_DATA_PATH, 'extensions-dir');

// Parse command-line arguments
const opts = minimist(process.argv.slice(2), {
	boolean: ['web', 'parallel',],
	string: ['f', 'g', 'jobs']
});

// Set environment variables based on options
configureEnvVarsFromOptions(opts);

// Main execution flow
prepareTestDataDirectory();
cloneTestRepo();
runMochaTests();

/**
 * Configures environment variables based on parsed options.
 */
function configureEnvVarsFromOptions(opts) {
	// Set environment variables based on options
	const envVars = {
		BUILD: opts['build'] || '',
		HEADLESS: opts['headless'] || '',
		PARALLEL: opts['parallel'] || '',
		REMOTE: opts['remote'] || '',
		TRACING: opts['tracing'] || '',
		VERBOSE: opts['verbose'] || '',
		WEB: opts['web'] || '',
		SUITE_TITLE: opts['web'] ? 'Smoke Tests (Browser)' : 'Smoke Tests (Electron)',
		EXTENSIONS_PATH: EXTENSIONS_PATH,
		WORKSPACE_PATH: WORKSPACE_PATH,
		TEST_DATA_PATH: TEST_DATA_PATH,
		REPORT_PATH: REPORT_PATH,
	};
	Object.assign(process.env, envVars);
}

/**
 * Returns the Mocha options based on the parsed arguments.
 */
function getMochaOptions(opts) {
	return {
		color: true,
		timeout: 1 * 60 * 1000,  // 1 minute
		slow: 30 * 1000,         // 30 seconds
		grep: opts['f'] || opts['g'],
		parallel: opts['parallel'],
		jobs: opts['jobs'],
		reporter: 'mocha-multi',
		reporterOptions: {
			spec: '-',  // Console output
			xunit: REPORT_PATH,
		},
		retries: 1,
	};
}

/**
 * Applies test filters based on environment variables.
 */
function applyTestFilters(mocha) {
	if (process.env.TEST_FILTER) {
		mocha.grep(process.env.TEST_FILTER);
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

	if (opts['test-repo']) {
		console.log('Copying test project repository from:', opts['test-repo']);
		// Remove the existing workspace path if the option is provided
		rimraf.sync(WORKSPACE_PATH);

		// Copy the repository based on the platform (Windows vs. non-Windows)
		if (process.platform === 'win32') {
			cp.execSync(`xcopy /E "${opts['test-repo']}" "${WORKSPACE_PATH}\\*"`);
		} else {
			cp.execSync(`cp -R "${opts['test-repo']}" "${WORKSPACE_PATH}"`);
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

function runMochaTests() {
	const mocha = new Mocha(getMochaOptions(opts));
	applyTestFilters(mocha);

	// Add test files to Mocha
	const testDirPath = path.resolve('out/test-list');
	fs.readdirSync(testDirPath).forEach(file => {
		if (file.endsWith('.js') && !file.includes('setupUtils')) {
			const filePath = path.join(testDirPath, file);
			mocha.addFile(filePath);
		}
	});

	// Run the tests
	mocha.run(failures => {
		// Handle test results
		if (failures) {
			console.log(getFailureLogs());
		} else {
			console.log('All tests passed.');
		}

		// Cleanup test data and handle exit
		cleanupTestData(err => {
			if (err) {
				console.log('Error cleaning up test data:', err);
			} else {
				process.exit(failures ? 1 : 0);  // Exit based on test results
			}
		});
	});
}

/**
 * Cleans up the test data directory after tests are complete.
 */
function cleanupTestData(callback) {
	rimraf(TEST_DATA_PATH, { maxBusyTries: 10 }, error => {
		if (error) {
			console.error('Error cleaning up test data:', error);
			return callback(error);
		}
		console.log('Test data cleaned up successfully.');
		callback(null);
	});
}
