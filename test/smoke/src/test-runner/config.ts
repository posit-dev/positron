/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as os from 'os';
import minimist = require('minimist');

const TEST_DATA_PATH = path.join(os.tmpdir(), 'vscsmoke');
export const OPTS = minimist(process.argv.slice(2));

// Set environment variables
Object.assign(process.env, {
	BUILD: OPTS['build'] || '',
	HEADLESS: OPTS['headless'] || '',
	PARALLEL: OPTS['parallel'] || '',
	REMOTE: OPTS['remote'] || '',
	TRACING: OPTS['tracing'] || '',
	VERBOSE: OPTS['verbose'] || '',
	WEB: OPTS['web'] || '',
	WIN: OPTS['win'] || '',
	ONLY: OPTS['only'] || '',
	PR: OPTS['pr'] || '',
	SKIP_CLEANUP: OPTS['skip-cleanup'] || '',
	TEST_DATA_PATH: TEST_DATA_PATH,
	ROOT_PATH: path.join(__dirname, '..', '..', '..', '..'),
	EXTENSIONS_PATH: path.join(TEST_DATA_PATH, 'extensions-dir'),
	WORKSPACE_PATH: path.join(TEST_DATA_PATH, 'qa-example-content'),
	REPORT_PATH: path.join(process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || '', 'test-results/'),
	LOGS_DIR: process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || 'smoke-tests-default',
});

