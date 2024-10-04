/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import * as path from 'path';
import { Logger, } from '../../../automation';
import { installAllHandlers, } from '../utils';
import { createLogger } from './logger';
import { OPTS } from './config';

export const ROOT_PATH = join(__dirname, '..', '..', '..');
const TEST_DATA_PATH = process.env.TEST_DATA_PATH || 'TEST_DATA_PATH not set';
const WORKSPACE_PATH = process.env.WORKSPACE_PATH || 'WORKSPACE_PATH not set';
const EXTENSIONS_PATH = process.env.EXTENSIONS_PATH || 'EXTENSIONS_PATH not set';
const LOGS_DIR = process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || 'smoke-tests-default';

/**
 * Setup the environment, logs, hooks for the test suite and then START the application.
 *
 * @returns The logger instance for the test suite.
 */
export function setupAndStartApp(): Logger {
	// Dynamically determine the test file name
	const suiteName = getTestFileName();
	const logsRootPath = join(ROOT_PATH, '.build', 'logs', LOGS_DIR, suiteName);
	const crashesRootPath = join(ROOT_PATH, '.build', 'crashes', LOGS_DIR, suiteName);

	// Create a new logger for this suite
	const logger = createLogger(logsRootPath);

	// Set test defaults and before/after hooks
	setTestDefaults(logger, logsRootPath, crashesRootPath);
	installAllHandlers(logger);

	return logger;
}

/**
 * Dynamically determines the test file path based on the caller's stack trace.
 *
 * @returns The file name of the test file.
 */
function getTestFileName(): string {
	const originalFunc = Error.prepareStackTrace;

	try {
		// Capture the stack trace
		const err = new Error();
		Error.prepareStackTrace = (_, stack) => stack;

		// Stack index 2 points to the immediate caller of this function
		const stackFrames = err.stack as any;
		const callerFilePath = stackFrames[2].getFileName();  // Adjust index based on context

		return path.basename(callerFilePath);
	} catch (e) {
		console.error('Failed to retrieve caller file name:', e);
		return 'unknown';
	} finally {
		// Restore the original stack trace behavior
		Error.prepareStackTrace = originalFunc;
	}
}

/**
 * Set the default options for the test suite.
 *
 * @param logger the logger instance for the test suite
 * @param logsRootPath  the root path for the logs
 * @param crashesRootPath the root path for the crashes
 */
function setTestDefaults(logger: Logger, logsRootPath: string, crashesRootPath: string) {
	before(async function () {
		this.defaultOptions = {
			codePath: OPTS.build,
			workspacePath: WORKSPACE_PATH,
			userDataDir: join(TEST_DATA_PATH, 'd'),
			extensionsPath: EXTENSIONS_PATH,
			logger,
			logsPath: join(logsRootPath, 'suite_unknown'),
			crashesPath: join(crashesRootPath, 'suite_unknown'),
			verbose: OPTS.verbose,
			remote: OPTS.remote,
			web: OPTS.web,
			tracing: OPTS.tracing,
			headless: OPTS.headless,
			browser: OPTS.browser,
			extraArgs: (OPTS.electronArgs || '').split(' ').map(arg => arg.trim()).filter(arg => !!arg),
		};
	});
}

