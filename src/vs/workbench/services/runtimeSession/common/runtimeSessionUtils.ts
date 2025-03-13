/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


/**
 * Generates a unique ID for a notebook session.
 * The ID consists of the prefix "n-" followed by a UUID, making it easily
 * identifiable as a notebook session.
 *
 * @returns A unique string ID for a notebook session
 */
export function generateNotebookSessionId(): string {
	return `n-${generateSimpleUuid()}`;
}

/**
 * Generates a simple UUID v4 string.
 * This is a simplified implementation to avoid external dependencies.
 *
 * @returns A string containing a randomly generated UUID
 */
function generateSimpleUuid(): string {
	// Create array of random bytes
	const bytes = new Uint8Array(16);
	for (let i = 0; i < 16; i++) {
		bytes[i] = Math.floor(Math.random() * 256);
	}

	// Set version to 4 (random UUID)
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	// Set variant to the RFC4122 spec
	bytes[8] = (bytes[8] & 0x3f) | 0x80;

	// Convert to hex representation
	const hexBytes = [];
	for (let i = 0; i < 16; i++) {
		hexBytes.push(bytes[i].toString(16).padStart(2, '0'));
	}

	// Format as standard UUID (8-4-4-4-12)
	return [
		hexBytes.slice(0, 4).join(''),
		hexBytes.slice(4, 6).join(''),
		hexBytes.slice(6, 8).join(''),
		hexBytes.slice(8, 10).join(''),
		hexBytes.slice(10, 16).join('')
	].join('-');
}
