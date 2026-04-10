/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { log } from './log';

type LogSink = Pick<typeof log, 'trace' | 'debug' | 'info' | 'warn' | 'error'>;

/**
 * Logger utility for authentication providers.
 *
 * Provides consistent logging patterns across all provider implementations
 * with provider-specific prefixes for easy identification in logs and
 * convenience methods for common authentication logging scenarios.
 *
 * @example
 * ```typescript
 * const logger = new AuthProviderLogger('AWS');
 * logger.logCredentialResolution('resolved', 'Using Workbench-managed credentials');
 * logger.logSessionChange('created', 'Creating session via Accounts menu');
 * logger.logOperationError('settings migration', error);
 * ```
 */
export class AuthProviderLogger {
	constructor(
		private readonly providerName: string,
		private readonly sink: LogSink = log,
	) { }

	trace(message: string, ...args: any[]): void {
		const formatted = this.formatMessage(message);
		if (args.length > 0) {
			this.sink.trace(formatted, ...args);
		} else {
			this.sink.trace(formatted);
		}
	}

	debug(message: string, ...args: any[]): void {
		const formatted = this.formatMessage(message);
		if (args.length > 0) {
			this.sink.debug(formatted, ...args);
		} else {
			this.sink.debug(formatted);
		}
	}

	info(message: string, ...args: any[]): void {
		const formatted = this.formatMessage(message);
		if (args.length > 0) {
			this.sink.info(formatted, ...args);
		} else {
			this.sink.info(formatted);
		}
	}

	warn(message: string, error?: Error | any, ...args: any[]): void {
		const formatted = this.formatMessage(message);
		const errorDetails = error ? this.formatError(error) : '';

		if (errorDetails) {
			this.sink.warn(`${formatted}: ${errorDetails}`, ...args);
		} else if (args.length > 0) {
			this.sink.warn(formatted, ...args);
		} else {
			this.sink.warn(formatted);
		}
	}

	error(message: string, error?: Error | any, ...args: any[]): void {
		const formatted = this.formatMessage(message);
		const errorDetails = error ? this.formatError(error) : '';

		if (errorDetails) {
			this.sink.error(`${formatted}: ${errorDetails}`, ...args);
		} else if (args.length > 0) {
			this.sink.error(formatted, ...args);
		} else {
			this.sink.error(formatted);
		}
	}

	/**
	 * Logs credential resolution activity.
	 *
	 * Failed resolutions log at debug level since initial failures
	 * may be retried. All other statuses log at info.
	 *
	 * @param status The resolution status.
	 * @param details Optional additional details.
	 */
	logCredentialResolution(
		status: 'resolved' | 'failed' | 'invalidated',
		details?: string
	): void {
		const message =
			`Credential resolution ${status}${details ? `: ${details}` : ''}`;
		if (status === 'failed') {
			this.debug(message);
		} else {
			this.info(message);
		}
	}

	/**
	 * Logs session lifecycle events.
	 *
	 * Retrieved sessions log at debug level. All other actions
	 * (created, removed, stored) log at info.
	 *
	 * @param action The session action.
	 * @param details Optional additional details.
	 */
	logSessionChange(
		action: 'created' | 'removed' | 'stored' | 'retrieved',
		details?: string
	): void {
		const message =
			`Session ${action}${details ? `: ${details}` : ''}`;
		if (action === 'retrieved') {
			this.debug(message);
		} else {
			this.info(message);
		}
	}

	/**
	 * Logs operation errors with context.
	 *
	 * @param operation The operation that failed.
	 * @param error The error that occurred.
	 */
	logOperationError(operation: string, error: Error | any): void {
		this.error(`Error in ${operation}`, error);
	}

	private formatMessage(message: string): string {
		return `[${this.providerName}] ${message}`;
	}

	private formatError(error: Error | any): string {
		if (error instanceof Error) {
			return error.message;
		} else if (typeof error === 'object' && error !== null) {
			return JSON.stringify(error, null, 2);
		} else if (typeof error === 'string') {
			return error;
		}
		return String(error);
	}
}
