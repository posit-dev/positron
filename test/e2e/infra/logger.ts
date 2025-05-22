/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendFileSync, writeFileSync, existsSync } from 'fs';
import { format } from 'util';
import { EOL } from 'os';
import path from 'path';

export interface Logger {
	log(message: string, ...args: any[]): void;
	setPath?(dir: string, filename?: string): void;
}

export class ConsoleLogger implements Logger {

	log(message: string, ...args: any[]): void {
		console.log('**', message, ...args);
	}
}

export class FileLogger implements Logger {
	private path: string;

	constructor(initialPath: string) {
		this.path = initialPath;
		this.ensureFileExists(this.path);
	}

	setPath(dir: string, filename = 'e2e-test-runner.log'): void {
		this.path = path.join(dir, filename);
		this.ensureFileExists(this.path);
	}

	private ensureFileExists(path: string): void {
		if (!existsSync(path)) {
			writeFileSync(path, '');
		}
	}

	log(message: string, ...args: any[]): void {
		const date = new Date().toISOString();
		const formattedMessage = `[${date}] ${format(message, ...args)}${EOL}`;
		try {
			appendFileSync(this.path, formattedMessage);
		} catch (error) {
			console.log('FileLogger error, falling back to console:', formattedMessage.trim(), error);
		}
	}
}

export class MultiLogger implements Logger {

	constructor(private loggers: Logger[]) { }

	setPath(dir: string, filename = 'e2e-test-runner.log'): void {
		for (const logger of this.loggers) {
			if (logger.setPath) {
				logger.setPath(dir, filename);
			}
		}
	}

	log(message: string, ...args: any[]): void {
		for (const logger of this.loggers) {
			logger.log(message, ...args);
		}
	}
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
