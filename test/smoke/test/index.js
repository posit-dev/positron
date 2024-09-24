/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

const { join } = require('path');
const Mocha = require('mocha');
const minimist = require('minimist');
const rimraf = require('rimraf');
const fs = require('fs');
const mkdirp = require('mkdirp');
const { cloneRepository, testDataPath } = require('../out/setupUtils');

// Parse command-line arguments
const opts = minimist(process.argv.slice(2), {
	boolean: ['web', 'parallel'],
	string: ['f', 'g']
});

const suite = opts['web'] ? 'Browser Smoke Tests' : 'Desktop Smoke Tests';
const mochaOptions = getMochaOptions(opts);
const mocha = new Mocha(mochaOptions);

applyTestFilters(mocha);
prepareTestDataDirectory(testDataPath);
runTests();

/**
 * Configure and return Mocha options.
 */
function getMochaOptions(opts) {
	return {
		color: true,
		timeout: 2 * 60 * 1000, // 2 minutes
		slow: 30 * 1000,        // 30 seconds
		grep: opts['f'] || opts['g'],
		parallel: opts['parallel'],
		reporter: process.env.BUILD_ARTIFACTSTAGINGDIRECTORY ? 'mocha-multi-reporters' : 'spec',
		reporterOptions: process.env.BUILD_ARTIFACTSTAGINGDIRECTORY ? {
			reporterEnabled: 'spec, mocha-junit-reporter',
			mochaJunitReporterReporterOptions: {
				testsuitesTitle: `${suite} ${process.platform}`,
				mochaFile: join(process.env.BUILD_ARTIFACTSTAGINGDIRECTORY, 'test-results/results.xml'),
			},
		} : {}
	};
}

/**
 * Apply test filtering based on environment variables after Mocha initialization.
 */
function applyTestFilters(mocha) {
	if (process.env.TEST_FILTER) {
		mocha.grep(process.env.TEST_FILTER);
	} else if (process.env.INVERSE_FILTER) {
		mocha.grep(process.env.INVERSE_FILTER).invert();
	}
}

/**
 * Clean up and recreate the test data directory.
 */
function prepareTestDataDirectory(testDataPath) {
	if (fs.existsSync(testDataPath)) {
		rimraf.sync(testDataPath);
	}
	mkdirp.sync(testDataPath);
}

/**
 * Clone the test repo and run Mocha tests.
 */
function runTests() {
	const workspacePath = join(testDataPath, 'qa-example-content');
	if (!fs.existsSync(workspacePath)) {
		cloneRepository(workspacePath, opts)
			.then(() => runMochaTests())
			.catch(err => handleError('Failed to clone test repo', err));
	} else {
		console.log('Repository already exists. Skipping clone.');
		runMochaTests();
	}
}

/**
 * Run the Mocha tests and handle results.
 */
async function runMochaTests() {
	addMochaTestFiles(mocha);

	try {
		const failures = await runMocha();
		handleTestResults(failures);
	} catch (error) {
		handleError('Error running Mocha tests', error);
	}
}

/**
 * Add test files to Mocha.
 */
function addMochaTestFiles(mocha) {
	mocha.addFile('out/main0.js');
	mocha.addFile('out/main1.js');
	mocha.addFile('out/main2.js');
}

/**
 * Run Mocha tests wrapped in a Promise for async support.
 */
function runMocha() {
	return new Promise((resolve, reject) => {
		const runner = mocha.run(failures => resolve(failures));

		// Cleanup after tests finish
		runner.on('end', async () => {
			try {
				await cleanupTestData(testDataPath);
				process.exit(0);
			} catch (error) {
				handleError('Error during cleanup', error);
			}
		});
	});
}

/**
 * Clean up the test data directory after tests complete.
 */
async function cleanupTestData(testDataPath) {
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
 * Handle test results and exit appropriately.
 */
function handleTestResults(failures) {
	if (failures) {
		console.log(getFailureLogs());
		process.exit(1);
	} else {
		console.log('All tests passed.');
		process.exit(0);
	}
}

/**
 * Return formatted log messages in case of failures.
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
