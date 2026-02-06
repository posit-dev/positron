/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as ai from 'ai';
import Anthropic from '@anthropic-ai/sdk';

export function mock<T>(obj: Partial<T>): T {
	return obj as T;
}

/**
 * Creates a Vercel AI SDK APICallError for rate limit testing.
 *
 * @param retryAfter - Optional retry-after header value in seconds
 * @param url - Optional URL for the error (defaults to anthropic API URL)
 */
export function createVercelRateLimitError(retryAfter?: string, url = 'https://api.anthropic.com/v1/messages'): ai.APICallError {
	return new ai.APICallError({
		message: 'Rate limit exceeded',
		url,
		requestBodyValues: {},
		statusCode: 429,
		responseHeaders: retryAfter ? { 'retry-after': retryAfter } : {},
		responseBody: JSON.stringify({ error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } }),
		isRetryable: true,
	});
}

/**
 * Creates a Native Anthropic SDK APIError for rate limit testing.
 *
 * @param retryAfter - Optional retry-after header value in seconds
 */
export function createNativeRateLimitError(retryAfter?: string) {
	const headers = new Headers();
	if (retryAfter) {
		headers.set('retry-after', retryAfter);
	}
	return new Anthropic.APIError(
		429,
		{ error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } },
		'Rate limit exceeded',
		headers
	);
}

/**
 * Creates a Vercel AI SDK APICallError for non-rate-limit error testing.
 *
 * @param statusCode - HTTP status code (e.g., 500)
 * @param message - Error message
 */
export function createVercelServerError(statusCode = 500, message = 'Internal server error'): ai.APICallError {
	return new ai.APICallError({
		message,
		url: 'https://api.anthropic.com/v1/messages',
		requestBodyValues: {},
		statusCode,
		responseHeaders: {},
		responseBody: JSON.stringify({ error: { type: 'server_error', message } }),
		isRetryable: true,
	});
}

/**
 * Asserts that an error message indicates a rate limit with retry-after information.
 *
 * @param error - The error to check
 * @param retryAfterSeconds - Expected retry-after value in seconds
 */
export function assertRateLimitErrorWithRetry(error: Error, retryAfterSeconds: string): void {
	assert.ok(error.message.includes('Rate limit exceeded'), 'Error message should mention rate limit');
	assert.ok(error.message.includes(`retry after ${retryAfterSeconds} seconds`), 'Error message should include retry-after value');
}

/**
 * Asserts that an error message indicates a rate limit without retry-after information.
 *
 * @param error - The error to check
 */
export function assertRateLimitErrorWithoutRetry(error: Error): void {
	assert.ok(error.message.includes('Rate limit exceeded'), 'Error message should mention rate limit');
	assert.ok(error.message.includes('try again later'), 'Error message should suggest trying later');
	assert.ok(!error.message.includes('retry after'), 'Error message should not include retry-after');
}
