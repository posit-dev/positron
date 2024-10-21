/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';
import mkdirp = require('mkdirp');
import { ConsoleLogger, FileLogger, Logger, MultiLogger } from '../../../automation';

const VERBOSE = process.env.VERBOSE === 'true';

/**
 * Create a logger instance.
 *
 * @param logsRootPath the root path for the logs
 * @returns Logger instance
 */
export function createLogger(logsRootPath: string): Logger {
	const logsFileName = `smoke-test-runner.log`;
	const loggers: Logger[] = [];

	if (VERBOSE) {
		loggers.push(new ConsoleLogger());
	}

	fs.rmSync(logsRootPath, { recursive: true, force: true, maxRetries: 3 });
	mkdirp.sync(logsRootPath);

	loggers.push(new FileLogger(path.join(logsRootPath, logsFileName)));

	return new MultiLogger(loggers);
}

/**
 * Logs a message to the file specified
 *
 * @param logFile the directory where the log file is saved
 * @param message the message to log
 */
function logToFile(logFilePath: string, message: string): void {
	const logDir = path.dirname(logFilePath);

	// Ensure the directory exists
	if (!fs.existsSync(logDir)) {
		fs.mkdirSync(logDir, { recursive: true });
	}

	// Remove ANSI escape codes from the message
	const ansiRegex = /\u001b\[[0-9;]*m/g;
	const cleanMessage = message.replace(ansiRegex, '');

	try {
		fs.appendFileSync(logFilePath, cleanMessage + '\n', 'utf-8');
	} catch (err) {
		console.error(`Error writing log to ${logFilePath}: ${(err as Error).message}`);
	}
}

/**
 * Logs the error to the test log file: logs/smoke-tests-electron/<test-file-name>/retry.log
 *
 * @param test mocha test
 * @param err error
 */
export function logErrorToFile(test: any, err: Error): void {
	const LOGS_ROOT_PATH = process.env.LOGS_ROOT_PATH || 'LOGS_ROOT_PATH not set';

	const fileName = path.basename(test.file);
	const testLogPath = path.join(LOGS_ROOT_PATH, fileName, 'retry.log');

	const title = `[RUN #${test.currentRetry()}] ${test.fullTitle()}`;
	const dashes = printDashes(title.length);
	const error = err.stack || err.message;

	logToFile(testLogPath, `${dashes}\n${title}\n${dashes}\n${error}\n`);
}

/**
 * Returns a string of dashes based on the length.
 *
 * @param length number of dashes to print
 * @returns string of dashes
 */
function printDashes(length: number): string {
	const minLength = 45;
	return '-'.repeat(Math.max(length, minLength));
}
