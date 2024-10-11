/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';
// eslint-disable-next-line local/code-import-patterns
import * as fsp from 'fs/promises';
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

// Log queue to ensure writes happen sequentially
const logQueue: Array<Promise<void>> = [];

/**
 * Log a message to a file using fs.promises and a queue.
 *
 * @param filePath the file path
 * @param message the message to log
 * @returns Promise<void>
 */
export async function logToFile(filePath: string, message: string): Promise<void> {
	const ansiRegex = /\u001b\[[0-9;]*m/g;
	const cleanMessage = message.replace(ansiRegex, '');  // Remove ANSI codes

	// Write operation that appends the message to the log file
	const writeOperation = async () => {
		await fsp.appendFile(filePath, cleanMessage + '\n', 'utf-8');
	};

	// Add the current write operation to the queue
	const lastOperation = logQueue.length > 0 ? logQueue[logQueue.length - 1] : Promise.resolve();

	// Chain the new write operation after the last one
	const newOperation = lastOperation.then(writeOperation);
	logQueue.push(newOperation);

	// Wait for the new operation to complete
	await newOperation;
}
