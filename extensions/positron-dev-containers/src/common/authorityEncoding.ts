/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Authority encoding utilities
 * Encodes/decodes information in remote URI authorities without needing external state
 */

/**
 * Encode a dev container authority
 * Format: dev-container+<containerId>
 *
 * NOTE: We no longer encode the workspace path in the authority to avoid
 * encoding issues with VS Code's internal URI storage. The workspace path
 * mapping is now stored in extension global state instead.
 *
 * @param containerId Container ID
 * @param _localWorkspacePath Deprecated parameter, kept for API compatibility but ignored
 */
export function encodeDevContainerAuthority(containerId: string, _localWorkspacePath?: string): string {
	return `dev-container+${containerId}`;
}

/**
 * Decode a dev container authority to extract container ID
 * Format: dev-container+<containerId>
 *
 * @param authority Authority string to decode
 * @returns Object with containerId, or undefined if invalid format
 */
export function decodeDevContainerAuthority(authority: string): {
	containerId: string;
	localWorkspacePath: string | undefined;
} | undefined {
	const match = authority.match(/^dev-container\+([^+]+)$/);
	if (!match) {
		return undefined;
	}

	const containerId = match[1];

	// Local workspace path is looked up from storage, not encoded in authority
	return { containerId, localWorkspacePath: undefined };
}

/**
 * Encode an attached container authority
 */
export function encodeAttachedContainerAuthority(containerId: string): string {
	return `attached-container+${containerId}`;
}
