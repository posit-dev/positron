/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// --- Start Positron ---
//@ts-check
'use strict';

const { join } = require('path');
const Mocha = require('mocha');
const minimist = require('minimist');
const rimraf = require('rimraf');
const fs = require('fs');
const mkdirp = require('mkdirp');
const { cloneTestRepository, testDataPath } = require('../out/setupUtils');

// Constants
const REPORT_PATH = join(process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || '', 'test-results/xunit-results.xml');
const TIMEOUT_MS = 2 * 60 * 1000;  // 2 minutes
const SLOW_MS = 30 * 1000;         // 30 seconds

// Parse command-line arguments
const opts = minimist(process.argv.slice(2), {
	boolean: ['web', 'parallel'],
	string: ['f', 'g']
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
	};

	Object.assign(process.env, envVars);
}

/**
 * Returns the Mocha options based on the parsed arguments.
 */
function getMochaOptions(opts) {
	return {
		color: true,
		timeout: TIMEOUT_MS,
		slow: SLOW_MS,
		grep: opts['f'] || opts['g'],
		parallel: opts['parallel'],
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
	if (fs.existsSync(testDataPath)) {
		rimraf.sync(testDataPath);
	}
	mkdirp.sync(testDataPath);
}

/**
 * Clones the test repository if it does not exist.
 */
function cloneTestRepo() {
	const workspacePath = join(testDataPath, 'qa-example-content');

	if (!fs.existsSync(workspacePath)) {
		cloneTestRepository(workspacePath, opts)
			.catch(err => handleError('Failed to clone test repo', err));
	} else {
		console.log('Repository already exists. Skipping clone.');
	}
}

/**
 * Runs the Mocha tests with the provided options and performs cleanup.
 */
async function runMochaTests() {
	const mocha = new Mocha(getMochaOptions(opts));
	applyTestFilters(mocha);

	// Add test files
	mocha.addFile('out/main0.js');
	mocha.addFile('out/main1.js');
	mocha.addFile('out/main2.js');

	try {
		// Run Mocha tests and await completion
		const failures = await new Promise((resolve, reject) => {
			const runner = mocha.run(failures => resolve(failures));

			// Cleanup after tests finish
			runner.on('end', async () => {
				try {
					await cleanupTestData(testDataPath);
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
function cleanupTestData(testDataPath) {
	return new Promise((resolve, reject) => {
		rimraf(testDataPath, { maxBusyTries: 10 }, error => {
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
