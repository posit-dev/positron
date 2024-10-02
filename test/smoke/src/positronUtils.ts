/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as mkdirp from 'mkdirp';
// import * as vscodetest from '@vscode/test-electron';
// import fetch from 'node-fetch';
import { MultiLogger, ConsoleLogger, FileLogger, Logger, } from '../../automation';
import { installAllHandlers, } from './utils';

export const ROOT_PATH = path.join(__dirname, '..', '..', '..');
const TEST_DATA_PATH = process.env.TEST_DATA_PATH || 'TEST_DATA_PATH not set';
const WORKSPACE_PATH = path.join(TEST_DATA_PATH, 'qa-example-content');
const EXTENSIONS_PATH = path.join(TEST_DATA_PATH, 'extensions-dir');
const LOGS_DIR = process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || 'smoke-tests-default';

const asBoolean = (value: string | undefined): boolean | undefined => {
	return value === 'true' ? true : value === 'false' ? false : undefined;
};

const OPTS: ParseOptions = {
	tracing: asBoolean(process.env.TRACING),
	parallel: asBoolean(process.env.PARALLEL),
	web: asBoolean(process.env.WEB),
	build: process.env.BUILD,
	remote: asBoolean(process.env.REMOTE),
	verbose: asBoolean(process.env.VERBOSE),
	headless: asBoolean(process.env.HEADLESS),
	browser: process.env.BROWSER,
	electronArgs: process.env.ELECTRON_ARGS,
	version: process.env.BUILD_VERSION,
};

/**
 * Setup the environment, logs, hooks for the test suite and then START the application.
 *
 * @returns The logger instance for the test suite.
 */
export function setupAndStartApp(): Logger {
	// Dynamically determine the test file name
	const suiteName = getTestFileName();
	const logsRootPath = path.join(ROOT_PATH, '.build', 'logs', LOGS_DIR, suiteName);
	const crashesRootPath = path.join(ROOT_PATH, '.build', 'crashes', LOGS_DIR, suiteName);

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

function setTestDefaults(logger: Logger, logsRootPath: string, crashesRootPath: string) {
	before(async function () {
		this.defaultOptions = {
			codePath: OPTS.build,
			workspacePath: WORKSPACE_PATH,
			userDataDir: path.join(TEST_DATA_PATH, 'd'),
			extensionsPath: EXTENSIONS_PATH,
			logger,
			logsPath: path.join(logsRootPath, 'suite_unknown'),
			crashesPath: path.join(crashesRootPath, 'suite_unknown'),
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

export function createLogger(logsRootPath: string): Logger {
	const loggers: Logger[] = [];

	if (OPTS.verbose) {
		loggers.push(new ConsoleLogger());
	}

	fs.rmSync(logsRootPath, { recursive: true, force: true, maxRetries: 3 });
	mkdirp.sync(logsRootPath);

	loggers.push(new FileLogger(path.join(logsRootPath, `smoke-test-runner.log`)));

	return new MultiLogger(loggers);
}

type ParseOptions = {
	verbose?: boolean;
	remote?: boolean;
	headless?: boolean;
	web?: boolean;
	tracing?: boolean;
	parallel?: boolean;
	build?: string;
	'stable-build'?: string;
	browser?: string;
	electronArgs?: string;
	version?: string;
};
