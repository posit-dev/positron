/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Authority encoding utilities
 * Encodes/decodes information in remote URI authorities without needing external state
 */

/**
 * Encode a dev container authority with local workspace path
 * Format: dev-container+<containerId>+<base64_encoded_local_path>
 */
export function encodeDevContainerAuthority(containerId: string, localWorkspacePath: string): string {
	const encoded = Buffer.from(localWorkspacePath).toString('base64')
		.replace(/\+/g, '-')  // Make URL-safe
		.replace(/\//g, '_')
		.replace(/=/g, '');   // Remove padding
	return `dev-container+${containerId}+${encoded}`;
}

/**
 * Decode a dev container authority to extract container ID and local workspace path
 */
export function decodeDevContainerAuthority(authority: string): {
	containerId: string;
	localWorkspacePath: string | undefined;
} | undefined {
	// Handle both old format (dev-container+<id>) and new format (dev-container+<id>+<path>)
	const match = authority.match(/^dev-container\+([^+]+)(?:\+(.+))?$/);
	if (!match) {
		return undefined;
	}

	const containerId = match[1];
	const encodedPath = match[2];

	if (!encodedPath) {
		// Old format without encoded path
		return { containerId, localWorkspacePath: undefined };
	}

	// Decode the path
	try {
		const base64 = encodedPath
			.replace(/-/g, '+')
			.replace(/_/g, '/');
		// Add padding if needed
		const padded = base64 + '==='.slice(0, (4 - base64.length % 4) % 4);
		const localWorkspacePath = Buffer.from(padded, 'base64').toString('utf8');
		return { containerId, localWorkspacePath };
	} catch (error) {
		// If decoding fails, return just the container ID
		return { containerId, localWorkspacePath: undefined };
	}
}

/**
 * Encode an attached container authority
 */
export function encodeAttachedContainerAuthority(containerId: string): string {
	return `attached-container+${containerId}`;
}
