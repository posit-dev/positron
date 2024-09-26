/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// --- Start Positron ---
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
function configureEnvVarsFromOptions(options) {
	const envVars = {
		BUILD: options['build'] || '',
		HEADLESS: options['headless'] || '',
		PARALLEL: options['parallel'] || '',
		REMOTE: options['remote'] || '',
		TRACING: options['tracing'] || '',
		VERBOSE: options['verbose'] || '',
		WEB: options['web'] || '',
		SUITE_TITLE: options['web'] ? 'Smoke Tests (Browser)' : 'Smoke Tests (Electron)',
		EXTENSIONS_PATH: EXTENSIONS_PATH,
		WORKSPACE_PATH: WORKSPACE_PATH,
		TEST_DATA_PATH: TEST_DATA_PATH,
	};

	Object.assign(process.env, envVars);
}

/**
 * Returns the Mocha options based on the parsed arguments.
 */
function getMochaOptions(opts) {
	return {
		color: true,
		timeout: 2 * 60 * 1000,  // 2 minutes
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
	const workspacePath = join(TEST_DATA_PATH, 'qa-example-content');
	const testRepoUrl = 'https://github.com/posit-dev/qa-example-content.git';

	if (opts['test-repo']) {
		console.log('Copying test project repository from:', opts['test-repo']);
		// Remove the existing workspace path if the option is provided
		rimraf.sync(workspacePath);

		// Copy the repository based on the platform (Windows vs. non-Windows)
		if (process.platform === 'win32') {
			cp.execSync(`xcopy /E "${opts['test-repo']}" "${workspacePath}\\*"`);
		} else {
			cp.execSync(`cp -R "${opts['test-repo']}" "${workspacePath}"`);
		}
	} else {
		// If no test-repo is specified, clone the repository if it doesn't exist
		if (!fs.existsSync(workspacePath)) {
			console.log('Cloning test project repository from:', testRepoUrl);
			const res = cp.spawnSync('git', ['clone', testRepoUrl, workspacePath], { stdio: 'inherit' });

			// Check if cloning failed by verifying if the workspacePath was created
			if (!fs.existsSync(workspacePath)) {
				throw new Error(`Clone operation failed: ${res.stderr?.toString()}`);
			}
		} else {
			console.log('Cleaning and updating test project repository...');
			// Fetch the latest changes, reset to the latest commit, and clean the repo
			cp.spawnSync('git', ['fetch'], { cwd: workspacePath, stdio: 'inherit' });
			cp.spawnSync('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: workspacePath, stdio: 'inherit' });
			cp.spawnSync('git', ['clean', '-xdf'], { cwd: workspacePath, stdio: 'inherit' });
		}
	}
}

/**
 * Runs the Mocha tests with the provided options and performs cleanup.
 */
async function runMochaTests() {
	const mocha = new Mocha(getMochaOptions(opts));
	// mocha.dryRun();
	applyTestFilters(mocha);

	// Add test files to Mocha
	const testDirPath = path.resolve('out/test-list');
	fs.readdirSync(testDirPath).forEach(file => {
		if (file.endsWith('.js') && !file.includes('setupUtils')) {
			const filePath = path.join(testDirPath, file);
			mocha.addFile(filePath);
		}
	});
	mocha.addFile(path.join(testDirPath, 'welcome.js'));

	try {
		// Run Mocha tests and await completion
		const failures = await new Promise((resolve, reject) => {
			const runner = mocha.run(failures => resolve(failures));

			// Cleanup after tests finish
			runner.on('end', async () => {
				try {
					await cleanupTestData(TEST_DATA_PATH);
					console.log('Test data cleaned up successfully.');
				} catch (error) {
					handleError('Error during cleanup', error);
				}
			});
		});

		// Handle test results
		if (failures) {
			console.log(getFailureLogs());
			process.exit(1);
		} else {
			console.log('All tests passed.');
			process.exit(0);
		}
	} catch (error) {
		handleError('Error running Mocha tests', error);
	}
}

/**
 * Cleans up the test data directory after tests are complete.
 */
function cleanupTestData(TEST_DATA_PATH) {
	return new Promise((resolve, reject) => {
		rimraf(TEST_DATA_PATH, { maxBusyTries: 10 }, error => {
			if (error) {
				return reject(error);
			}
			console.log('Test data cleaned up successfully.');
			resolve('success');
		});
	});
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
 * Generic error handler.
 */
function handleError(message, error) {
	console.error(`${message}:`, error);
	process.exit(1);
}
// --- End Positron ---
