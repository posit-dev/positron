/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { HttpError } from './kcclient/api';
import { Buffer } from 'buffer';
import * as vscode from 'vscode';

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
	} else if (err.errors) {
		// If we have multiple errors (as in the case of an AggregateError),
		// summarize each one
		return err.errors.map(summarizeError).join('\n\n');
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

// --- Serialized Data Unpacking Logic ---

/**
 * Gets the maximum allowed buffer size from user settings.
 * Default is 10MB, but can be configured between 1MB and 100MB.
 *
 * @returns The maximum buffer size in bytes
 */
function getMaxBufferSize(): number {
	const config = vscode.workspace.getConfiguration('kernelSupervisor');
	const maxSizeMB = config.get<number>('maxBufferSizeMB') ?? 10;
	return maxSizeMB * 1024 * 1024; // Convert MB to bytes
}

type VSBufferLike = {
	buffer: Buffer;
};

// Structure within the 'data.value' property
type SerializedDataValue = {
	data: unknown; // The actual data payload
	buffers?: (Buffer | VSBufferLike | unknown)[]; // Array containing potential buffers
	// We might have other properties within data.value
	[key: string]: unknown;
};

// Define the structure of the 'data' property in the payload
type PayloadData = {
	value?: SerializedDataValue;
	// Other properties within 'data' if any
	[key: string]: unknown;
};

type PayloadStructure = {
	data?: PayloadData;
	// Other top-level properties of the payload
	[key: string]: unknown;
};

/**
 * @description Type predicate to check if an object is VSBufferLike ({ buffer: Buffer }).
 * @param item - The item to check.
 * @returns True if the item is VSBufferLike, false otherwise.
 */
function isVSBufferLike(item: unknown): item is VSBufferLike {
	return (
		typeof item === 'object' &&
		item !== null &&
		'buffer' in item &&
		item.buffer instanceof Buffer // Direct check after confirming 'buffer' exists
	);
}

// Type assertion to narrow down PayloadStructure further after checks
type PayloadWithDataValue = PayloadStructure & {
	data: PayloadData & {
		value: SerializedDataValue;
	};
};

/**
 * @description Type predicate to check if the payload has the required nested data.value structure.
 * @param payload - The payload to check.
 * @returns True if the payload has the expected structure, false otherwise.
 */
function isPayloadWithDataValue(payload: unknown): payload is PayloadWithDataValue {
	return (
		// Check if payload is an object and has a 'data' property which is also an object
		typeof payload === 'object' &&
		payload !== null &&
		'data' in payload &&
		typeof payload.data === 'object' &&
		payload.data !== null &&
		// Now that we know payload.data is a non-null object, check for 'value' property
		'value' in payload.data &&
		typeof payload.data.value === 'object' &&
		payload.data.value !== null
	);
}

/**
 * @description Validates if an item is a Buffer or VSBufferLike and within the size limit.
 * @param item - The item to validate.
 * @param maxSize - The maximum allowed buffer size in bytes.
 * @returns The Buffer instance if valid, otherwise undefined.
 */
function validateAndGetBufferInstance(item: unknown, maxSize: number): Buffer | undefined {
	let bufferInstance: Buffer | undefined;

	if (isVSBufferLike(item)) {
		if (item.buffer.length > maxSize) {
			console.warn(`Buffer exceeds size limit (${item.buffer.length} > ${maxSize} bytes)`);
			return undefined;
		}
		bufferInstance = item.buffer;
	} else if (item instanceof Buffer) {
		if (item.length > maxSize) {
			console.warn(`Buffer exceeds size limit (${item.length} > ${maxSize} bytes)`);
			return undefined;
		}
		bufferInstance = item;
	}
	// else: item is not a Buffer or the expected VSBuffer-like structure

	return bufferInstance;
}

/**
 * @description Unpacks a payload object that may contain serialized data with associated buffers.
 *              It extracts Buffers (either directly or from a VSBuffer-like structure like { buffer: Buffer })
 *              found in `payload.data.value.buffers`, converts them to base64 strings,
 *              and restructures the content payload. If the expected structure isn't found,
 *              the original payload is returned as content with empty buffers.
 * @param payload - The input payload, potentially containing serialized data and buffers.
 * @returns An object containing the processed content and an array of base64 buffer strings.
 * @export
 */
export function unpackSerializedObjectWithBuffers(payload: unknown): {
	content: unknown; // The potentially modified content payload
	buffers: string[]; // Array of base64 encoded buffers
} {
	// Use the type predicate to check the payload structure
	if (isPayloadWithDataValue(payload)) {
		const maxSize = getMaxBufferSize();
		const { data: { value: dataValue }, ...otherPayloadProps } = payload;
		// The 'potentialBuffers' array (derived from
		// payload.data.value.buffers) is expected to contain elements that are
		// either direct Buffer instances or objects conforming to the
		// VSBufferLike structure ({ buffer: Buffer }). This field exists when
		// the payload the webview has sent contains buffers (which is somewhat
		// rare).
		const potentialBuffers = dataValue.buffers;
		const buffers: string[] = [];

		if (Array.isArray(potentialBuffers)) {
			for (const item of potentialBuffers) {
				try {
					const bufferInstance = validateAndGetBufferInstance(item, maxSize);

					// If we found a valid Buffer, convert it to base64
					if (bufferInstance) {
						buffers.push(bufferInstance.toString('base64'));
					}
				} catch (e) {
					console.error('Error processing buffer:', e);
					// Continue processing other buffers
				}
			}
		}

		// Reconstruct the content: Original payload properties (excluding 'data') + the 'data' field from 'data.value'
		const content = { ...otherPayloadProps, data: dataValue.data };

		return { content, buffers };
	}

	// If the structure data.value is not found, return the original payload as content and empty buffers
	return { content: payload, buffers: [] };
}

/**
 * @description Type guard to check if a value is a member of an enum.
 * @param value The value to check.
 * @param enumObj The enum object to check against.
 * @returns Whether the value is a member of the enum.
 */
export function isEnumMember<T extends Record<string, unknown>>(value: unknown, enumObj: T): value is T[keyof T] {
	return Object.values(enumObj).includes(value as T[keyof T]);
}

export function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}
