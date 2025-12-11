/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { log } from '../../extension';

/**
 * Logger utility for model providers.
 *
 * Provides consistent logging patterns across all provider implementations with:
 * - Provider-specific prefixes for easy identification in logs
 * - Standardized log levels (trace, debug, info, warn, error)
 * - Structured error logging with proper formatting
 * - Convenience methods for common logging scenarios
 *
 * All log messages are automatically prefixed with the provider name to make it
 * easy to filter and track provider-specific activity.
 *
 * @example
 * ```typescript
 * const logger = new ModelProviderLogger('OpenAI');
 * logger.info('Fetching models from API...');
 * logger.debug('API response received', response);
 * logger.error('Failed to authenticate', error);
 * ```
 *
 * @see {@link log} from extension module for the underlying logger
 */
export class ModelProviderLogger {
	/**
	 * Creates a new logger instance for a specific provider.
	 *
	 * @param providerName - The name of the provider (e.g., 'OpenAI', 'Anthropic')
	 */
	constructor(private readonly providerName: string) { }

	/**
	 * Logs a debug message.
	 * Use for detailed diagnostic information during development.
	 *
	 * @param message The message to log.
	 * @param args Additional arguments to log.
	 */
	debug(message: string, ...args: any[]): void {
		const formattedMessage = this.formatMessage(message);
		if (args.length > 0) {
			log.debug(formattedMessage, ...args);
		} else {
			log.debug(formattedMessage);
		}
	}

	/**
	 * Logs a trace message.
	 * Use for the most detailed diagnostic information.
	 *
	 * @param message The message to log.
	 * @param args Additional arguments to log.
	 */
	trace(message: string, ...args: any[]): void {
		const formattedMessage = this.formatMessage(message);
		if (args.length > 0) {
			log.trace(formattedMessage, ...args);
		} else {
			log.trace(formattedMessage);
		}
	}

	/**
	 * Logs an info message.
	 * Use for general informational messages (default log level).
	 *
	 * @param message The message to log.
	 * @param args Additional arguments to log.
	 */
	info(message: string, ...args: any[]): void {
		const formattedMessage = this.formatMessage(message);
		if (args.length > 0) {
			log.info(formattedMessage, ...args);
		} else {
			log.info(formattedMessage);
		}
	}

	/**
	 * Logs a warning message.
	 * Use for potentially problematic situations that don't prevent operation.
	 *
	 * @param message The message to log.
	 * @param error Optional error object.
	 * @param args Additional arguments to log.
	 */
	warn(message: string, error?: Error | any, ...args: any[]): void {
		const formattedMessage = this.formatMessage(message);
		const errorDetails = error ? this.formatError(error) : '';

		if (errorDetails) {
			log.warn(`${formattedMessage}: ${errorDetails}`, ...args);
		} else if (args.length > 0) {
			log.warn(formattedMessage, ...args);
		} else {
			log.warn(formattedMessage);
		}
	}

	/**
	 * Logs an error message.
	 * Use for error conditions that affect functionality.
	 *
	 * @param message The message to log.
	 * @param error Optional error object.
	 * @param args Additional arguments to log.
	 */
	error(message: string, error?: Error | any, ...args: any[]): void {
		const formattedMessage = this.formatMessage(message);
		const errorDetails = error ? this.formatError(error) : '';

		if (errorDetails) {
			log.error(`${formattedMessage}: ${errorDetails}`, ...args);
		} else if (args.length > 0) {
			log.error(formattedMessage, ...args);
		} else {
			log.error(formattedMessage);
		}
	}

	/**
	 * Formats a message with the provider prefix.
	 *
	 * @param message The message to format.
	 * @returns The formatted message.
	 */
	private formatMessage(message: string): string {
		return `[${this.providerName}] ${message}`;
	}

	/**
	 * Formats an error object for logging.
	 *
	 * @param error The error to format.
	 * @returns The formatted error string.
	 */
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

	/**
	 * Logs connection attempt information.
	 *
	 * @param attempt The current attempt number.
	 * @param maxAttempts The maximum number of attempts.
	 */
	logConnectionAttempt(attempt: number, maxAttempts: number): void {
		this.debug(`Attempting connection... (attempt ${attempt}/${maxAttempts})`);
	}

	/**
	 * Logs model retrieval information.
	 *
	 * @param count The number of models retrieved.
	 * @param source The source of the models (e.g., 'config', 'api', 'default').
	 */
	logModelRetrieval(count: number, source: string): void {
		this.info(`Retrieved ${count} models from ${source}`);
	}

	/**
	 * Logs authentication status.
	 *
	 * @param status The authentication status.
	 * @param details Optional additional details.
	 */
	logAuthentication(status: 'success' | 'failure' | 'pending', details?: string): void {
		const message = `Authentication ${status}${details ? `: ${details}` : ''}`;
		if (status === 'failure') {
			this.error(message);
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
}