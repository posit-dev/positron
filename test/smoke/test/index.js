/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

const { join } = require('path');
const Mocha = require('mocha');
const minimist = require('minimist');

const [, , ...args] = process.argv;
const opts = minimist(args, {
	boolean: ['web'],
	string: ['f', 'g']
});

const suite = opts['web'] ? 'Browser Smoke Tests' : 'Desktop Smoke Tests';

const options = {
	color: true,
	timeout: 2 * 60 * 1000,
	slow: 30 * 1000,
	grep: opts['f'] || opts['g'],
	parallel: true,
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
mocha.addFile('out/main1.js');
mocha.addFile('out/main2.js');

// --- Start Positron ---
if (process.env.TEST_FILTER) {
	mocha.grep(process.env.TEST_FILTER);
} else if (process.env.INVERSE_FILTER) {
	mocha.grep(process.env.INVERSE_FILTER);
	mocha.invert();
}
// mocha.dryRun(); // debugging filters
// --- End Positron ---
mocha.run(failures => {

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

	process.exit(failures ? -1 : 0);
});
