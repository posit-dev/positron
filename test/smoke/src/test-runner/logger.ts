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
