/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

// Output channel for logging
let outputChannel: vscode.LogOutputChannel | undefined;

// Buffer to store log entries for diagnostics report
interface LogEntry {
	timestamp: Date;
	level: 'info' | 'warn' | 'error' | 'debug' | 'trace';
	message: string;
}

const logBuffer: LogEntry[] = [];
const MAX_LOG_ENTRIES = 500;

function addLogEntry(level: LogEntry['level'], message: string): void {
	logBuffer.push({
		timestamp: new Date(),
		level,
		message
	});
	// Keep buffer size bounded
	if (logBuffer.length > MAX_LOG_ENTRIES) {
		logBuffer.shift();
	}
}

/**
 * Get the VS Code log output channel.
 */
export function getOutputChannel(): vscode.LogOutputChannel {
	if (!outputChannel) {
		outputChannel = vscode.window.createOutputChannel('Environment Modules', { log: true });
	}
	return outputChannel;
}

/**
 * Logger object that writes to both the VS Code output channel and an in-memory buffer.
 */
export const log = {
	get channel(): vscode.LogOutputChannel {
		return getOutputChannel();
	},
	info(message: string): void {
		addLogEntry('info', message);
		this.channel.info(message);
	},
	warn(message: string): void {
		addLogEntry('warn', message);
		this.channel.warn(message);
	},
	error(message: string): void {
		addLogEntry('error', message);
		this.channel.error(message);
	},
	debug(message: string): void {
		addLogEntry('debug', message);
		this.channel.debug(message);
	},
	trace(message: string): void {
		addLogEntry('trace', message);
		this.channel.trace(message);
	}
};

/**
 * Get a copy of the log buffer for the diagnostics report.
 */
export function getLogBuffer(): ReadonlyArray<LogEntry> {
	return [...logBuffer];
}

/**
 * Clear the log buffer.
 */
export function clearLogBuffer(): void {
	logBuffer.length = 0;
}

/**
 * @deprecated Use `log` object instead for new code. This function is kept for
 * backwards compatibility with existing code that uses getLog().
 */
export function getLog(): vscode.LogOutputChannel {
	return getOutputChannel();
}
