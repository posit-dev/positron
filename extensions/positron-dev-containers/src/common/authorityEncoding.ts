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
 * Format: dev-container+<workspaceName>
 *
 * NOTE: We use the workspace name as the authority identifier for better display
 * in the remote status indicator. The full container ID mapping is stored in
 * extension global state.
 *
 * @param containerId Container ID
 * @param workspaceName Optional workspace folder name for display purposes
 */
export function encodeDevContainerAuthority(containerId: string, workspaceName?: string): string {
	if (workspaceName) {
		// Use workspace name as the authority identifier for display
		// VS Code will show "Dev Container" in the remote indicator
		return `dev-container+${workspaceName}`;
	}
	return `dev-container+${containerId}`;
}

/**
 * Decode a dev container authority to extract workspace name or container ID
 * Format: dev-container+<workspaceNameOrContainerId>
 *
 * @param authority Authority string to decode
 * @returns Object with containerId (which may be workspace name), or undefined if invalid format
 */
export function decodeDevContainerAuthority(authority: string): {
	containerId: string;
	localWorkspacePath: string | undefined;
} | undefined {
	const match = authority.match(/^dev-container\+([^+]+)$/);
	if (!match) {
		return undefined;
	}

	// The identifier could be either a workspace name or a container ID
	// The ConnectionManager and WorkspaceMappingStorage will resolve it
	const identifier = match[1];
	return { containerId: identifier, localWorkspacePath: undefined };
}

/**
 * Encode an attached container authority
 */
export function encodeAttachedContainerAuthority(containerId: string): string {
	return `attached-container+${containerId}`;
}
