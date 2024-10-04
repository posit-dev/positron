/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';
import minimist = require('minimist');
import rimraf = require('rimraf');
import Mocha = require('mocha');

const TEST_DATA_PATH = process.env.TEST_DATA_PATH || 'TEST_DATA_PATH not set';
const REPORT_PATH = process.env.REPORT_PATH || 'REPORT_PATH not set';

/**
 * Runs Mocha tests.
 */
export function runMochaTests(OPTS: minimist.ParsedArgs) {
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
	const runner = mocha.run(failures => {
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

	// Attach the 'retry' event listener to the runner
	runner.on('retry', (test, err) => {
		console.error('Test failed, retrying:', test.fullTitle());
		console.error(err);
	});
}

/**
 * Applies test filters based on environment variables.
 */
function applyTestFilters(mocha: Mocha): void {
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
 * Recursively finds all test files in child directories.
 */
function findTestFilesRecursive(dirPath: string): string[] {
	let testFiles: string[] = [];
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
function cleanupTestData(callback: (error: Error | null) => void) {
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
 * Returns formatted failure log messages.
 */
function getFailureLogs(): string {
	const rootPath = path.join(__dirname, '..', '..', '..');
	const logPath = path.join(rootPath, '.build', 'logs');

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
