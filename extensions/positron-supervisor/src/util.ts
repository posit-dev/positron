/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { HttpError } from './kcclient/api';

/**
 * Creates a short, unique ID. Use to help create unique identifiers for
 * comms, messages, etc.
 *
 * @returns An 8-character unique ID, like `a1b2c3d4`
 */
export function createUniqueId(): string {
	return Math.floor(Math.random() * 0x100000000).toString(16);
}

/**
 * Summarizes an error into a human-readable string. Used for serializing
 * errors reported across the Positron API boundary.
 *
 * @param err An error to summarize.
 * @returns A human-readable string summarizing the error.
 */
export function summarizeError(err: any): string {
	if (err instanceof HttpError) {
		// HTTP errors are common and should be summarized
		return summarizeHttpError(err);
	} else if (err instanceof Error) {
		// Other errors should be summarized as their message
		return err.message;
	} else if (typeof err === 'string') {
		// Strings are returned as-is
		return err;
	}
	// For anything else, return the JSON representation
	return JSON.stringify(err);
}

/**
 * Summarizes an HTTP error into a human-readable string. Used for serializing
 * structured errors reported up to Positron where only a string can be
 * displayed.
 *
 * @param err The error to summarize.
 * @returns A human-readable string summarizing the error.
 */
export function summarizeHttpError(err: HttpError): string {
	let result = '';

	// Add the URL if it's available
	if (err.response && err.response.url) {
		result += `${err.response.url}: `;
	}

	// Add the status code
	if (err.statusCode) {
		result += `HTTP ${err.statusCode}. `;
	}

	// Add the message if it's available
	if (err.body) {
		if (err.body.message) {
			// If the error has a specific message, return that.
			result += `${err.body.message}`;
		} else {
			if (typeof err.body === 'string') {
				// If the body is a string, return that.
				result += err.body;
			} else {
				// Otherwise, return the JSON representation of the body.
				result += JSON.stringify(err.body);
			}
		}
	}
	return result;
}
