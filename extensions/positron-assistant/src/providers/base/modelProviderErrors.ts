/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Base error class for all provider-related errors.
 * Provides a common structure for error handling across providers.
 */
export class ProviderError extends Error {
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
 * Use for API key validation failures, expired tokens, etc.
 */
export class AuthenticationError extends ProviderError {
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
 * Use when the provider returns rate limit errors.
 */
export class RateLimitError extends ProviderError {
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