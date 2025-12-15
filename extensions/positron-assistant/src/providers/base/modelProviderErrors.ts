/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Provider error types and utilities.
 *
 * This module defines a hierarchy of error types for model provider operations,
 * providing structured error handling across all providers. Each error type
 * includes:
 * - Provider name for context
 * - Error code for programmatic handling
 * - Detailed error message
 *
 * The error hierarchy allows callers to catch specific error types and handle
 * them appropriately (e.g., prompting for credentials on AuthenticationError).
 *
 * @module modelProviderErrors
 *
 * @example
 * ```typescript
 * try {
 *   await provider.resolveConnection(token);
 * } catch (error) {
 *   if (isAuthenticationError(error)) {
 *     // Prompt user to re-enter credentials
 *   } else if (isRateLimitError(error)) {
 *     // Wait and retry
 *   }
 * }
 * ```
 */

/**
 * Base error class for all provider-related errors.
 *
 * Provides a common structure for error handling across providers with
 * automatic provider name prefixing and optional error codes for
 * programmatic handling.
 *
 * @example
 * ```typescript
 * throw new ProviderError('OpenAI', 'Connection timeout', 'TIMEOUT_ERROR');
 * ```
 */
export class ProviderError extends Error {
	/**
	 * Creates a new provider error.
	 *
	 * @param providerName - The name of the provider where the error occurred
	 * @param message - The error message
	 * @param code - Optional error code for programmatic handling
	 */
	constructor(
		public readonly providerName: string,
		message: string,
		public readonly code?: string
	) {
		super(`[${providerName}] ${message}`);
		this.name = 'ProviderError';
		Object.setPrototypeOf(this, ProviderError.prototype);
	}
}

/**
 * Error thrown when authentication fails.
 *
 * Use this error for scenarios such as:
 * - Invalid or missing API keys
 * - Expired authentication tokens
 * - Insufficient permissions
 * - OAuth flow failures
 *
 * @example
 * ```typescript
 * if (!apiKey || !isValidApiKey(apiKey)) {
 *   throw new AuthenticationError('OpenAI', 'Invalid or missing API key');
 * }
 * ```
 */
export class AuthenticationError extends ProviderError {
	/**
	 * Creates a new authentication error.
	 *
	 * @param providerName - The name of the provider where authentication failed
	 * @param message - Description of the authentication failure
	 */
	constructor(providerName: string, message: string) {
		super(providerName, message, 'AUTHENTICATION_ERROR');
		this.name = 'AuthenticationError';
		Object.setPrototypeOf(this, AuthenticationError.prototype);
	}
}

/**
 * Error thrown when model retrieval fails.
 * Use when models cannot be fetched from API or configuration.
 */
export class ModelRetrievalError extends ProviderError {
	constructor(providerName: string, message: string) {
		super(providerName, message, 'MODEL_RETRIEVAL_ERROR');
		this.name = 'ModelRetrievalError';
		Object.setPrototypeOf(this, ModelRetrievalError.prototype);
	}
}

/**
 * Error thrown when connection to the provider fails.
 * Use for network errors, timeouts, or unavailable services.
 */
export class ConnectionError extends ProviderError {
	constructor(providerName: string, message: string) {
		super(providerName, message, 'CONNECTION_ERROR');
		this.name = 'ConnectionError';
		Object.setPrototypeOf(this, ConnectionError.prototype);
	}
}

/**
 * Error thrown when the provider configuration is invalid.
 * Use for missing required settings or invalid configuration values.
 */
export class ConfigurationError extends ProviderError {
	constructor(providerName: string, message: string) {
		super(providerName, message, 'CONFIGURATION_ERROR');
		this.name = 'ConfigurationError';
		Object.setPrototypeOf(this, ConfigurationError.prototype);
	}
}

/**
 * Error thrown when rate limits are exceeded.
 *
 * Use this error when the provider returns rate limit errors (typically HTTP 429).
 * Includes an optional `retryAfter` field indicating when the client can retry
 * the request.
 *
 * @example
 * ```typescript
 * if (response.status === 429) {
 *   const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
 *   throw new RateLimitError('OpenAI', 'Rate limit exceeded', retryAfter);
 * }
 * ```
 */
export class RateLimitError extends ProviderError {
	/**
	 * Creates a new rate limit error.
	 *
	 * @param providerName - The name of the provider where rate limit was exceeded
	 * @param message - Description of the rate limit error
	 * @param retryAfter - Optional number of seconds to wait before retrying
	 */
	constructor(
		providerName: string,
		message: string,
		public readonly retryAfter?: number
	) {
		super(providerName, message, 'RATE_LIMIT_ERROR');
		this.name = 'RateLimitError';
		Object.setPrototypeOf(this, RateLimitError.prototype);
	}
}

/**
 * Error thrown when the requested model is not found.
 * Use when a specific model ID is requested but not available.
 */
export class ModelNotFoundError extends ProviderError {
	constructor(
		providerName: string,
		public readonly modelId: string
	) {
		super(providerName, `Model '${modelId}' not found`, 'MODEL_NOT_FOUND');
		this.name = 'ModelNotFoundError';
		Object.setPrototypeOf(this, ModelNotFoundError.prototype);
	}
}

/**
 * Error thrown when the provider returns an invalid response.
 * Use for malformed API responses or unexpected data formats.
 */
export class InvalidResponseError extends ProviderError {
	constructor(
		providerName: string,
		message: string,
		public readonly response?: any
	) {
		super(providerName, message, 'INVALID_RESPONSE');
		this.name = 'InvalidResponseError';
		Object.setPrototypeOf(this, InvalidResponseError.prototype);
	}
}

/**
 * Helper function to determine if an error is a provider error.
 *
 * @param error The error to check.
 * @returns True if the error is a ProviderError or subclass.
 */
export function isProviderError(error: any): error is ProviderError {
	return error instanceof ProviderError;
}

/**
 * Helper function to determine if an error is an authentication error.
 *
 * @param error The error to check.
 * @returns True if the error is an AuthenticationError.
 */
export function isAuthenticationError(error: any): error is AuthenticationError {
	return error instanceof AuthenticationError;
}

/**
 * Helper function to determine if an error is a rate limit error.
 *
 * @param error The error to check.
 * @returns True if the error is a RateLimitError.
 */
export function isRateLimitError(error: any): error is RateLimitError {
	return error instanceof RateLimitError;
}