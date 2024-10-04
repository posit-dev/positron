/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

require('./out/test-runner/config'); // must import first to set up the env vars
const minimist = require('minimist');
const { prepareTestEnv, cloneTestRepo, runMochaTests } = require('./out/test-runner');
const OPTS = minimist(process.argv.slice(2));

(function main() {
	prepareTestEnv();
	cloneTestRepo();
	runMochaTests(OPTS);
})();
