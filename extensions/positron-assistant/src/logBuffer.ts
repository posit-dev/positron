/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface LogEntry {
	timestamp: Date;
	level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
	message: string;
}

/**
 * A wrapper around LogOutputChannel that maintains an in-memory circular buffer
 * of recent log entries for diagnostics collection.
 */
export class BufferedLogOutputChannel implements vscode.LogOutputChannel {
	private readonly buffer: LogEntry[] = [];

	constructor(
		private readonly channel: vscode.LogOutputChannel,
		private readonly maxEntries: number = 500
	) { }

	get logLevel(): vscode.LogLevel {
		return this.channel.logLevel;
	}

	get onDidChangeLogLevel(): vscode.Event<vscode.LogLevel> {
		return this.channel.onDidChangeLogLevel;
	}

	get name(): string {
		return this.channel.name;
	}

	append(value: string): void {
		this.channel.append(value);
	}

	appendLine(value: string): void {
		this.channel.appendLine(value);
	}

	replace(value: string): void {
		this.channel.replace(value);
	}

	clear(): void {
		this.channel.clear();
	}

	show(preserveFocus?: boolean): void;
	show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
	show(columnOrPreserveFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void {
		this.channel.show(columnOrPreserveFocus as any, preserveFocus);
	}

	hide(): void {
		this.channel.hide();
	}

	dispose(): void {
		this.channel.dispose();
	}

	private addToBuffer(level: LogEntry['level'], message: string): void {
		this.buffer.push({
			timestamp: new Date(),
			level,
			message
		});

		if (this.buffer.length > this.maxEntries) {
			this.buffer.shift();
		}
	}

	private formatMessageWithArgs(message: string, args: any[]): string {
		return args.length > 0 ? `${message} ${args.join(' ')}` : message;
	}

	trace(message: string, ...args: any[]): void {
		this.addToBuffer('trace', this.formatMessageWithArgs(message, args));
		this.channel.trace(message, ...args);
	}

	debug(message: string, ...args: any[]): void {
		this.addToBuffer('debug', this.formatMessageWithArgs(message, args));
		this.channel.debug(message, ...args);
	}

	info(message: string, ...args: any[]): void {
		this.addToBuffer('info', this.formatMessageWithArgs(message, args));
		this.channel.info(message, ...args);
	}

	warn(message: string, ...args: any[]): void {
		this.addToBuffer('warn', this.formatMessageWithArgs(message, args));
		this.channel.warn(message, ...args);
	}

	error(message: string | Error, ...args: any[]): void {
		const formattedMessage = message instanceof Error
			? `${message.message}\n${message.stack}`
			: this.formatMessageWithArgs(message, args);
		this.addToBuffer('error', formattedMessage);
		this.channel.error(message, ...args);
	}

	formatEntriesForDiagnostics(count: number = 500): string {
		const entries = count < this.buffer.length
			? this.buffer.slice(-count)
			: this.buffer;

		if (entries.length === 0) {
			return 'No log entries available';
		}

		return entries.map(entry => {
			const timestamp = entry.timestamp.toISOString();
			const levelStr = entry.level.toUpperCase().padEnd(5);
			return `[${timestamp}] ${levelStr} ${entry.message}`;
		}).join('\n');
	}
}
