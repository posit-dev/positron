/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export class Logger {
	private static instance: Logger | undefined;
	private outputChannel: vscode.LogOutputChannel;
	private startTime: number;

	private constructor() {
		this.outputChannel = vscode.window.createOutputChannel('Positron MCP', { log: true });
		this.startTime = Date.now();
		
		// Show the output channel on first creation if in debug mode
		const config = vscode.workspace.getConfiguration('positron.mcp');
		const logLevel = config.get<string>('logLevel', 'info');
		if (logLevel === 'debug' || logLevel === 'trace') {
			this.outputChannel.show(true);
		}
	}

	static getInstance(): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger();
		}
		return Logger.instance;
	}

	private formatMessage(_level: string, context: string, message: string, data?: any): string {
		const elapsed = Date.now() - this.startTime;
		const timestamp = `+${elapsed}ms`;
		let formatted = `[${timestamp}] [${context}] ${message}`;
		
		if (data !== undefined) {
			if (typeof data === 'object') {
				try {
					formatted += '\n' + JSON.stringify(data, null, 2);
				} catch (e) {
					formatted += '\n' + String(data);
				}
			} else {
				formatted += ' ' + String(data);
			}
		}
		
		return formatted;
	}

	trace(context: string, message: string, data?: any): void {
		this.outputChannel.trace(this.formatMessage('TRACE', context, message, data));
	}

	debug(context: string, message: string, data?: any): void {
		this.outputChannel.debug(this.formatMessage('DEBUG', context, message, data));
	}

	info(context: string, message: string, data?: any): void {
		this.outputChannel.info(this.formatMessage('INFO', context, message, data));
	}

	warn(context: string, message: string, data?: any): void {
		this.outputChannel.warn(this.formatMessage('WARN', context, message, data));
	}

	error(context: string, message: string, error?: any): void {
		let errorData = error;
		if (error instanceof Error) {
			errorData = {
				message: error.message,
				stack: error.stack,
				name: error.name
			};
		}
		this.outputChannel.error(this.formatMessage('ERROR', context, message, errorData));
	}

	// MCP-specific logging helpers
	logMcpRequest(method: string, params?: any): void {
		const logLevel = this.outputChannel.logLevel;
		
		if (logLevel <= vscode.LogLevel.Debug) {
			// In debug mode, log full request details
			this.debug('MCP.Request', `${method}`, params);
		} else if (logLevel <= vscode.LogLevel.Info) {
			// In info mode, just log the method
			this.info('MCP.Request', `${method}`);
		}
	}

	logMcpResponse(method: string, success: boolean, data?: any): void {
		const logLevel = this.outputChannel.logLevel;
		
		if (logLevel <= vscode.LogLevel.Debug) {
			// In debug mode, log full response
			const status = success ? 'SUCCESS' : 'ERROR';
			this.debug('MCP.Response', `${method} [${status}]`, data);
		} else if (logLevel <= vscode.LogLevel.Info && !success) {
			// In info mode, only log errors
			this.error('MCP.Response', `${method} failed`, data);
		}
	}

	logApiCall(api: string, method: string, args?: any): void {
		const logLevel = this.outputChannel.logLevel;
		
		if (logLevel <= vscode.LogLevel.Debug) {
			this.debug('API.Call', `${api}.${method}`, args);
		} else if (logLevel <= vscode.LogLevel.Trace) {
			this.trace('API.Call', `${api}.${method}`, args);
		}
	}

	logApiResult(api: string, method: string, success: boolean, result?: any): void {
		const logLevel = this.outputChannel.logLevel;
		
		if (logLevel <= vscode.LogLevel.Debug) {
			const status = success ? 'SUCCESS' : 'ERROR';
			this.debug('API.Result', `${api}.${method} [${status}]`, result);
		} else if (logLevel <= vscode.LogLevel.Info && !success) {
			this.error('API.Result', `${api}.${method} failed`, result);
		}
	}

	// Server lifecycle logging
	logServerStart(port: number): void {
		this.info('Server', `MCP server starting on port ${port}`);
	}

	logServerStarted(port: number): void {
		this.info('Server', `MCP server successfully started on http://localhost:${port}`);
	}

	logServerStop(): void {
		this.info('Server', 'MCP server stopping');
	}

	logServerStopped(): void {
		this.info('Server', 'MCP server stopped');
	}

	// Show the output channel
	show(): void {
		this.outputChannel.show(true);
	}

	dispose(): void {
		this.outputChannel.dispose();
	}
}

// Export singleton instance getter for convenience
export function getLogger(): Logger {
	return Logger.getInstance();
}