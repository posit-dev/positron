/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendFileSync, writeFileSync } from 'fs';
import { format } from 'util';
import { EOL } from 'os';

export interface Logger {
	log(message: string, ...args: any[]): void;
	// --- Start Positron
	close?(): void;
	// --- End Positron
}

export class ConsoleLogger implements Logger {

	log(message: string, ...args: any[]): void {
		console.log('**', message, ...args);
	}
}

export class FileLogger implements Logger {
	// --- Start Positron
	private closed = false;
	// --- End Positron

	constructor(private path: string) {
		writeFileSync(path, '');
	}

	log(message: string, ...args: any[]): void {
		// --- Start Positron
		if (this.closed) {
			console.warn(`Attempted to log to closed logger: ${message}`);
			return;
		}
		// --- End Positron

		const date = new Date().toISOString();
		appendFileSync(this.path, `[${date}] ${format(message, ...args)}${EOL}`);
	}

	// --- Start Positron
	close(): void {
		this.closed = true;
	}
	// --- End Positron
}

export class MultiLogger implements Logger {
	constructor(private loggers: Logger[]) { }

	log(message: string, ...args: any[]): void {
		for (const logger of this.loggers) {
			logger.log(message, ...args);
		}
	}

	// --- Start Positron
	close(): void {
		for (const logger of this.loggers) {
			if (logger.close) {
				logger.close();
			}
		}
	}
	// --- End Positron
}

export async function measureAndLog<T>(promiseFactory: () => Promise<T>, name: string, logger: Logger): Promise<T> {
	const now = Date.now();

	logger.log(`Starting operation '${name}'...`);

	let res: T | undefined = undefined;
	let e: unknown;
	try {
		res = await promiseFactory();
	} catch (error) {
		e = error;
	}

	if (e) {
		logger.log(`Finished operation '${name}' with error ${e} after ${Date.now() - now}ms`);
		throw e;
	}

	logger.log(`Finished operation '${name}' successfully after ${Date.now() - now}ms`);

	return res as unknown as T;
}
