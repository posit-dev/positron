/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

const { join } = require('path');
const Mocha = require('mocha');  // Ensure Mocha is properly imported
const minimist = require('minimist');
const rimraf = require('rimraf');

const fs = require('fs');
const { setupRepository } = require('../out/setupUtils');

// Parse command-line options
const [, , ...args] = process.argv;
const opts = minimist(args, {
	// --- Start Positron ---
	boolean: ['web', 'parallel'],
	// --- End Positron ---
	string: ['f', 'g']
});

const suite = opts['web'] ? 'Browser Smoke Tests' : 'Desktop Smoke Tests';

// Set up Mocha options
const options = {
	color: true,
	timeout: 2 * 60 * 1000,
	slow: 30 * 1000,
	grep: opts['f'] || opts['g'],
	// --- Start Positron ---
	parallel: opts['parallel'],
	// --- End Positron ---
};

if (process.env.BUILD_ARTIFACTSTAGINGDIRECTORY) {
	options.reporter = 'mocha-multi-reporters';
	options.reporterOptions = {
		reporterEnabled: 'spec, mocha-junit-reporter',
		mochaJunitReporterReporterOptions: {
			testsuitesTitle: `${suite} ${process.platform}`,
			mochaFile: join(process.env.BUILD_ARTIFACTSTAGINGDIRECTORY, `test-results/results.xml`)
		}
	};
}

const mocha = new Mocha(options);

// --- Start Positron ---
// Define paths for repository setup and logs
const testDataPath = join(require('os').tmpdir(), 'vscsmoke_shared');
const workspacePath = join(testDataPath, 'qa-example-content');

// Check if the repository already exists to avoid re-cloning
if (!fs.existsSync(workspacePath)) {
	console.log('Cloning test repository...');
	setupRepository(workspacePath, console, opts).then(() => {
		runMochaTests();  // Run Mocha tests after the repository is set up
	}).catch((err) => {
		console.error('Failed to set up repository:', err);
		process.exit(1);
	});
} else {
	console.log('Repository already exists. Skipping clone...');
	runMochaTests();  // Run Mocha tests if the repository is already set up
}

async function runMochaTests() {
	mocha.addFile('out/main1.js');
	mocha.addFile('out/main2.js');

	// Wrap Mocha.run() inside a Promise so we can await it
	const failures = await new Promise((resolve, reject) => {
		const runner = mocha.run(failures => {
			// Log failures, if any
			if (failures) {
				// Indicate location of log files for further diagnosis
				if (failures) {
					const rootPath = join(__dirname, '..', '..', '..');
					const logPath = join(rootPath, '.build', 'logs');

					if (process.env.BUILD_ARTIFACTSTAGINGDIRECTORY) {
						console.log(`
###################################################################
#                                                                 #
# Logs are attached as build artefact and can be downloaded       #
# from the build Summary page (Summary -> Related -> N published) #
#                                                                 #
# Show playwright traces on: https://trace.playwright.dev/        #
#                                                                 #
###################################################################
		`);
					} else {
						console.log(`
#############################################
#
# Log files of client & server are stored into
# '${logPath}'.
#
# Logs of the smoke test runner are stored into
# 'smoke-test-runner.log' in respective folder.
#
#############################################
		`);
					}
				}

			} else {
				console.log('All tests passed.');
			}
			// Resolve with failure count (used for process exit code)
			resolve(failures);
		});

		// Use the "end" event to trigger cleanup once tests are done
		runner.on('end', async () => {
			try {
				await cleanupTestData(testDataPath);
			} catch (error) {
				console.error('Error during cleanup:', error);
				process.exit(1);
			}

			// Exit process with success/failure code
			process.exit(failures ? 1 : 0);
		});
	});
}

// Cleanup function after all tests
async function cleanupTestData(testDataPath) {
	try {
		await new Promise((resolve, reject) => {
			rimraf(testDataPath, { maxBusyTries: 10 }, error => {
				if (error) {
					return reject(error);
				}
				console.log('Test data cleaned up successfully.');
				resolve('success');
			});
		});
	} catch (error) {
		console.error(`Failed to clean up test data: ${error}`);
		throw error;
	}
}
// --- End Positron ---
