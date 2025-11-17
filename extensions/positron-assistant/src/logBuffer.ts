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

export const DIAGNOSTIC_LOG_BUFFER_SIZE = 500;

/**
 * A wrapper around LogOutputChannel that maintains an in-memory circular buffer
 * of recent log entries for diagnostics collection.
 */
export class BufferedLogOutputChannel implements vscode.LogOutputChannel {
	private readonly buffer: LogEntry[] = [];
	private readonly maxEntries: number;

	constructor(
		private readonly channel: vscode.LogOutputChannel,
		maxEntries: number = DIAGNOSTIC_LOG_BUFFER_SIZE
	) {
		this.maxEntries = maxEntries;
	}

	// Implement LogOutputChannel interface by delegating to the wrapped channel
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
		if (typeof columnOrPreserveFocus === 'boolean') {
			this.channel.show(columnOrPreserveFocus);
		} else {
			this.channel.show(columnOrPreserveFocus, preserveFocus);
		}
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

		// Keep buffer size under limit (circular buffer behavior)
		if (this.buffer.length > this.maxEntries) {
			this.buffer.shift();
		}
	}

	trace(message: string, ...args: any[]): void {
		const formattedMessage = this.formatMessage(message, args);
		this.addToBuffer('trace', formattedMessage);
		this.channel.trace(message, ...args);
	}

	debug(message: string, ...args: any[]): void {
		const formattedMessage = this.formatMessage(message, args);
		this.addToBuffer('debug', formattedMessage);
		this.channel.debug(message, ...args);
	}

	info(message: string, ...args: any[]): void {
		const formattedMessage = this.formatMessage(message, args);
		this.addToBuffer('info', formattedMessage);
		this.channel.info(message, ...args);
	}

	warn(message: string, ...args: any[]): void {
		const formattedMessage = this.formatMessage(message, args);
		this.addToBuffer('warn', formattedMessage);
		this.channel.warn(message, ...args);
	}

	error(message: string | Error, ...args: any[]): void {
		const formattedMessage = message instanceof Error
			? `${message.message}\n${message.stack}`
			: this.formatMessage(message, args);
		this.addToBuffer('error', formattedMessage);
		this.channel.error(message, ...args);
	}

	/**
	 * Get recent log entries from the buffer.
	 * @param count Number of entries to retrieve (default: all)
	 * @param level Minimum log level to include (default: all)
	 */
	getRecentEntries(count?: number, level?: LogEntry['level']): LogEntry[] {
		let entries = [...this.buffer];

		// Filter by level if specified
		if (level) {
			const levels: LogEntry['level'][] = ['trace', 'debug', 'info', 'warn', 'error'];
			const minLevelIndex = levels.indexOf(level);
			entries = entries.filter(entry => levels.indexOf(entry.level) >= minLevelIndex);
		}

		// Limit count if specified
		if (count !== undefined && count < entries.length) {
			entries = entries.slice(-count);
		}

		return entries;
	}

	/**
	 * Format log entries as text for inclusion in diagnostics.
	 * @param count Number of entries to include (default: 500)
	 * @param level Minimum log level to include (default: 'trace')
	 */
	formatEntriesForDiagnostics(count: number = 500, level: LogEntry['level'] = 'trace'): string {
		const entries = this.getRecentEntries(count, level);

		if (entries.length === 0) {
			return 'No log entries available';
		}

		const formatted = entries.map(entry => {
			const timestamp = entry.timestamp.toISOString();
			const levelStr = entry.level.toUpperCase().padEnd(5);
			return `[${timestamp}] ${levelStr} ${entry.message}`;
		}).join('\n');

		const totalInBuffer = this.buffer.length;
		const note = entries.length < totalInBuffer
			? `\n\n(Showing ${entries.length} of ${totalInBuffer} total entries in buffer)`
			: '';

		return formatted + note;
	}

	/**
	 * Clear the log buffer.
	 */
	clearBuffer(): void {
		this.buffer.length = 0;
	}

	private formatMessage(message: string, args: any[]): string {
		if (args.length === 0) {
			return message;
		}
		// Simple formatting - VS Code handles the actual formatting for the output channel
		return message + (args.length > 0 ? ' ' + args.map(a =>
			typeof a === 'object' ? JSON.stringify(a) : String(a)
		).join(' ') : '');
	}
}
