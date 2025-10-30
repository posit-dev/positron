/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export enum LogLevel {
	TRACE = 0,
	DEBUG = 1,
	INFO = 2,
	WARN = 3,
	ERROR = 4
}

let channel: vscode.OutputChannel | undefined;
let currentLogLevel = LogLevel.INFO;

export function initializeLogging(): void {
	channel = vscode.window.createOutputChannel('Catalog Explorer');

	const config = vscode.workspace.getConfiguration('catalogExplorer');
	const logLevelStr = config.get<string>('logLevel', 'INFO');
	const configuredLevel = LogLevel[logLevelStr as keyof typeof LogLevel];
	if (configuredLevel !== undefined) {
		currentLogLevel = configuredLevel;
	}

}

function log(level: LogLevel, prefix: string, args: any[]): void {
	if (level < currentLogLevel || !channel) {
		return;
	}
	channel.appendLine(`${prefix}: ${args.map(a => String(a)).join(' ')}`);
}

export function traceLog(...args: any[]): void {
	log(LogLevel.TRACE, 'LOG', args);
}

export function traceVerbose(...args: any[]): void {
	log(LogLevel.DEBUG, 'DEBUG', args);
}

export function traceInfo(...args: any[]): void {
	log(LogLevel.INFO, 'INFO', args);
}

export function traceWarn(...args: any[]): void {
	log(LogLevel.WARN, 'WARN', args);
}

export function traceError(...args: any[]): void {
	log(LogLevel.ERROR, 'ERROR', args);
}
