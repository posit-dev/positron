/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Thin wrapper over a {@link vscode.LogOutputChannel}. The channel already
 * timestamps entries and filters by the user-selected log level, so this only
 * adds a `[context]` tag and serializes structured data.
 */
export class Logger {
	private static instance: Logger | undefined;
	private readonly outputChannel: vscode.LogOutputChannel;

	private constructor() {
		this.outputChannel = vscode.window.createOutputChannel('Positron MCP', { log: true });

		// Pop the channel open when the user has opted into verbose logging.
		const logLevel = vscode.workspace.getConfiguration('positron.mcp').get<string>('logLevel', 'info');
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

	private format(context: string, message: string, data?: unknown): string {
		if (data === undefined) {
			return `[${context}] ${message}`;
		}
		let detail: string;
		if (typeof data === 'object') {
			try {
				detail = JSON.stringify(data, null, 2);
			} catch {
				detail = String(data);
			}
		} else {
			detail = String(data);
		}
		return `[${context}] ${message}\n${detail}`;
	}

	trace(context: string, message: string, data?: unknown): void {
		this.outputChannel.trace(this.format(context, message, data));
	}

	debug(context: string, message: string, data?: unknown): void {
		this.outputChannel.debug(this.format(context, message, data));
	}

	info(context: string, message: string, data?: unknown): void {
		this.outputChannel.info(this.format(context, message, data));
	}

	warn(context: string, message: string, data?: unknown): void {
		this.outputChannel.warn(this.format(context, message, data));
	}

	error(context: string, message: string, error?: unknown): void {
		const data = error instanceof Error ? { message: error.message, stack: error.stack, name: error.name } : error;
		this.outputChannel.error(this.format(context, message, data));
	}

	show(): void {
		this.outputChannel.show(true);
	}

	dispose(): void {
		this.outputChannel.dispose();
	}
}

export function getLogger(): Logger {
	return Logger.getInstance();
}
