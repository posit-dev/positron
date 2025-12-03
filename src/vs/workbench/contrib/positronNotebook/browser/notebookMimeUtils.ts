/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Image MIME types that should be base64 encoded when serializing notebook outputs.
 * Excludes SVG (image/svg+xml) which is text-based XML.
 */
export const IMAGE_MIME_TYPES = [
	'image/png',
	'image/jpeg',
	'image/jpg',
	'image/gif',
	'image/webp',
	'image/bmp'
] as const;

/**
 * Text-based MIME types that should be converted to string when serializing notebook outputs.
 * Note: This list is not exhaustive - isTextBasedMimeType() also handles any MIME type starting
 * with 'text/' and 'image/svg+xml'.
 */
export const TEXT_BASED_MIME_TYPES = [
	'text/latex',
	'text/html',
	'application/xml',
	'application/vnd.code.notebook.error',
	'application/vnd.code.notebook.stdout',
	'application/x.notebook.stdout',
	'application/x.notebook.stream',
	'application/vnd.code.notebook.stderr',
	'application/x.notebook.stderr',
	'text/plain',
	'text/markdown',
	'application/json'
] as const;

/**
 * Set of image MIME types for fast O(1) lookups.
 */
const IMAGE_MIME_TYPES_SET = new Set<string>(IMAGE_MIME_TYPES);

/**
 * Set of text-based MIME types for fast O(1) lookups.
 */
const TEXT_BASED_MIME_TYPES_SET = new Set<string>(TEXT_BASED_MIME_TYPES);

/**
 * Checks if a MIME type represents an image that should be base64 encoded.
 * @param mimeType The MIME type to check.
 * @returns True if the MIME type is an image type that requires base64 encoding.
 */
export function isImageMimeType(mimeType: string): boolean {
	return IMAGE_MIME_TYPES_SET.has(mimeType.toLowerCase());
}

/**
 * Checks if a MIME type represents text-based content that should be handled as plain text.
 * Returns true for:
 * - MIME types in the TEXT_BASED_MIME_TYPES list
 * - Any MIME type starting with 'text/' (e.g., 'text/xml', 'text/csv')
 * - 'image/svg+xml' (SVG is text-based XML)
 * @param mimeType The MIME type to check.
 * @returns True if the MIME type is text-based and should be converted to string.
 */
export function isTextBasedMimeType(mimeType: string): boolean {
	const lowerMimeType = mimeType.toLowerCase();

	if (TEXT_BASED_MIME_TYPES_SET.has(lowerMimeType)) {
		return true;
	}

	if (lowerMimeType.startsWith('text/')) {
		return true;
	}

	if (lowerMimeType === 'image/svg+xml') {
		return true;
	}

	return false;
}

