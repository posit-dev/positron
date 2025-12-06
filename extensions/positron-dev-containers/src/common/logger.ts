/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LogLevel } from './types';

/**
 * Logger for the dev containers extension
 * Provides both output channel logging and file logging
 */
export class Logger {
	private static instance: Logger;
	private outputChannel: vscode.LogOutputChannel;
	private logLevel: LogLevel = LogLevel.Debug;
	private logFilePath?: string;
	private logFileStream?: fs.WriteStream;

	private constructor() {
		this.outputChannel = vscode.window.createOutputChannel('Dev Containers', { log: true });
	}

	/**
	 * Get the singleton logger instance
	 */
	static getInstance(): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger();
		}
		return Logger.instance;
	}

	/**
	 * Initialize the logger with context
	 */
	initialize(context: vscode.ExtensionContext, logLevel: LogLevel): void {
		this.logLevel = logLevel;

		// Create log file
		const logDir = path.join(context.globalStorageUri.fsPath, 'logs');
		if (!fs.existsSync(logDir)) {
			fs.mkdirSync(logDir, { recursive: true });
		}

		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		this.logFilePath = path.join(logDir, `dev-containers-${timestamp}.log`);

		try {
			this.logFileStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
			this.info(`Logger initialized. Log file: ${this.logFilePath}`);
		} catch (error) {
			this.error('Failed to create log file', error);
		}
	}

	/**
	 * Set the log level
	 */
	setLogLevel(level: LogLevel): void {
		this.logLevel = level;
		this.info(`Log level set to: ${level}`);
	}

	/**
	 * Get the current log file path
	 */
	getLogFilePath(): string | undefined {
		return this.logFilePath;
	}

	/**
	 * Show the output channel
	 */
	show(): void {
		this.outputChannel.show();
	}

	/**
	 * Log an info message
	 */
	info(message: string, ...args: any[]): void {
		if (this.shouldLog(LogLevel.Info)) {
			this.log(LogLevel.Info, message, ...args);
		}
	}

	/**
	 * Log a debug message
	 */
	debug(message: string, ...args: any[]): void {
		if (this.shouldLog(LogLevel.Debug)) {
			this.log(LogLevel.Debug, message, ...args);
		}
	}

	/**
	 * Log a trace message
	 */
	trace(message: string, ...args: any[]): void {
		if (this.shouldLog(LogLevel.Trace)) {
			this.log(LogLevel.Trace, message, ...args);
		}
	}

	/**
	 * Log an error message
	 */
	error(message: string, error?: any): void {
		if (!this.shouldLog(LogLevel.Error)) {
			return;
		}

		const errorMessage = error
			? `${message}: ${error instanceof Error ? error.message : String(error)}`
			: message;

		this.log(LogLevel.Error, errorMessage);

		// Log stack trace at debug level
		if (error instanceof Error && error.stack) {
			this.debug(`Stack trace: ${error.stack}`);
		}
	}

	/**
	 * Log a warning message
	 */
	warn(message: string, ...args: any[]): void {
		if (this.shouldLog(LogLevel.Warning)) {
			this.log(LogLevel.Warning, message, ...args);
		}
	}

	/**
	 * Dispose the logger
	 */
	dispose(): void {
		this.outputChannel.dispose();
		if (this.logFileStream) {
			this.logFileStream.end();
		}
	}

	/**
	 * Check if a message at the given level should be logged
	 */
	private shouldLog(level: LogLevel): boolean {
		// Log level hierarchy: Trace < Debug < Info < Warning < Error
		const levels = [LogLevel.Trace, LogLevel.Debug, LogLevel.Info, LogLevel.Warning, LogLevel.Error];
		const currentLevelIndex = levels.indexOf(this.logLevel);
		const messageLevelIndex = levels.indexOf(level);
		return messageLevelIndex >= currentLevelIndex;
	}

	/**
	 * Internal log method
	 */
	private log(level: LogLevel, message: string, ...args: any[]): void {
		const timestamp = new Date().toISOString();
		const formattedMessage = args.length > 0
			? `${message} ${args.map(arg => JSON.stringify(arg)).join(' ')}`
			: message;

		// Log to output channel using appropriate method
		switch (level) {
			case LogLevel.Trace:
				this.outputChannel.trace(formattedMessage);
				break;
			case LogLevel.Debug:
				this.outputChannel.debug(formattedMessage);
				break;
			case LogLevel.Info:
				this.outputChannel.info(formattedMessage);
				break;
			case LogLevel.Warning:
				this.outputChannel.warn(formattedMessage);
				break;
			case LogLevel.Error:
				this.outputChannel.error(formattedMessage);
				break;
		}

		// Log to file
		if (this.logFileStream) {
			const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${formattedMessage}\n`;
			this.logFileStream.write(logEntry);
		}
	}
}

/**
 * Convenience function to get the logger instance
 */
export function getLogger(): Logger {
	return Logger.getInstance();
}
