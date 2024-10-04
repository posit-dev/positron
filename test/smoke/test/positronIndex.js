/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

// must import the config file first to set up the environment variables
require('../out/test-runner/config');
const minimist = require('minimist');
const { prepareTestEnv, cloneTestRepo, runMochaTests } = require('../out/test-runner');
const OPTS = minimist(process.argv.slice(2));

(function main() {
	prepareTestEnv();
	cloneTestRepo();
	runMochaTests(OPTS);
})();
