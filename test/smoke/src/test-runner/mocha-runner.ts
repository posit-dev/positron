/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
// eslint-disable-next-line local/code-import-patterns
import * as fs from 'fs/promises';
const Mocha = require('mocha');

const TEST_DATA_PATH = process.env.TEST_DATA_PATH || 'TEST_DATA_PATH not set';
const REPORT_PATH = process.env.REPORT_PATH || 'REPORT_PATH not set';

/**
 * Runs Mocha tests.
 */
export async function runMochaTests(OPTS: any) {
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
		retries: 1,
	});

	// Apply test filters based on CLI options
	applyTestFilters(mocha);

	// Add test files to the Mocha runner
	const testFiles = await findTestFilesRecursive(path.resolve('out/areas/positron'));
	testFiles.forEach(file => mocha.addFile(file));

	// Run the Mocha tests
	const runner = mocha.run(async failures => {
		if (failures) {
			console.log(getFailureLogs());
		} else {
			console.log('All tests passed.');
		}

		await cleanupTestData();
		process.exit(failures ? 1 : 0);
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
	const filters = {
		WEB: /#web/,
		WIN: /#win/,
		PR: /#pr/,
		ONLY: /#only/
	};

	Object.keys(filters).forEach((key) => {
		if (process.env[key]) {
			mocha.grep(filters[key]);
		}
	});

	if (process.env.INVERSE_FILTER) {
		mocha.grep(process.env.INVERSE_FILTER).invert();
	}
}

/**
 * Recursively finds all test files in child directories.
 */
async function findTestFilesRecursive(dirPath: string): Promise<string[]> {
	let testFiles: string[] = [];

	const entries = await fs.readdir(dirPath, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name);
		if (entry.isDirectory()) {
			// If it's a directory, recursively search within it
			const subDirFiles = await findTestFilesRecursive(fullPath);
			testFiles = testFiles.concat(subDirFiles);
		} else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.startsWith('example.test.js')) {
			// If it's a file, add it if it matches the criteria
			testFiles.push(fullPath);
		}
	}

	return testFiles;
}

/**
 * Cleans up the test data directory.
 */
async function cleanupTestData(): Promise<void> {
	if (process.env.SKIP_CLEANUP) {
		console.log('Skipping test data cleanup.');
		return;
	}

	try {
		console.log('Cleaning up test data directory. FYI: This can be bypassed with --skip-cleanup');
		await fs.rm(TEST_DATA_PATH, { recursive: true, force: true });
		console.log('Cleanup completed successfully.');
	} catch (error) {
		console.error(`Error cleaning up test data: ${error}`);
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
