/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Logger } from '../common/logger';
import { ConnectionManager, ConnectionState } from './connectionManager';
import { decodeDevContainerAuthority } from '../common/authorityEncoding';
import { WorkspaceMappingStorage } from '../common/workspaceMappingStorage';

/**
 * Authority types supported by the resolver
 */
export enum AuthorityType {
	DevContainer = 'dev-container',
	AttachedContainer = 'attached-container'
}

/**
 * Parsed authority information
 */
export interface ParsedAuthority {
	type: AuthorityType;
	containerId: string;
	raw: string;
}

/**
 * Remote authority resolver for dev containers
 * Implements vscode.RemoteAuthorityResolver to enable remote connections to containers
 */
export class DevContainerAuthorityResolver implements vscode.RemoteAuthorityResolver {
	private logger: Logger;
	private connectionManager: ConnectionManager;

	constructor(logger: Logger, connectionManager: ConnectionManager) {
		this.logger = logger;
		this.connectionManager = connectionManager;
	}

	/**
	 * Resolve a remote authority
	 * Called by VS Code when connecting to a remote with our authority scheme
	 */
	async resolve(authority: string): Promise<vscode.ResolverResult> {
		this.logger.info(`===== AUTHORITY RESOLVER: resolve() called =====`);
		this.logger.info(`Resolving authority: ${authority}`);

		// --- Start Positron ---
		// If we're already in a remote context, log it for debugging
		// VS Code may call resolve() even when remote for verification purposes
		if (vscode.env.remoteName) {
			this.logger.info(`Already in remote context: ${vscode.env.remoteName}`);
		}
		// --- End Positron ---

		try {
			// Parse the authority
			const parsed = this.parseAuthority(authority);
			this.logger.info(`Parsed authority: type=${parsed.type}, containerId=${parsed.containerId}`);

			// Check for existing connection
			const existing = this.connectionManager.getConnection(parsed.containerId);
			if (existing && existing.state === ConnectionState.Connected) {
				this.logger.info(`Using existing connection to ${parsed.containerId}`);
				const resolvedAuthority = new vscode.ResolvedAuthority(
					existing.host,
					existing.port,
					existing.connectionToken
				);

				// Return ResolverResult with environment variables
				// Note: We don't set isTrusted here - we rely on getCanonicalURI mapping
				// to let VS Code recognize that the remote workspace maps to a trusted local workspace
				return Object.assign(resolvedAuthority, {
					extensionHostEnv: existing.extensionHostEnv
				});
			}

			// Establish new connection (pass full authority for path decoding)
			this.logger.info(`Establishing new connection to ${parsed.containerId}`);
			const connection = await this.connectionManager.connect(parsed.containerId, authority);

			// Return resolved authority with environment variables
			const resolvedAuthority = new vscode.ResolvedAuthority(
				connection.host,
				connection.port,
				connection.connectionToken
			);

			this.logger.info(`Authority resolved: ${connection.host}:${connection.port}`);
			this.logger.debug(`Extension host env: ${JSON.stringify(connection.extensionHostEnv, null, 2)}`);

			// --- Start Positron ---
			// Add workspace folder metadata to help VS Code display the correct path
			const options: any = {
				extensionHostEnv: connection.extensionHostEnv
			};

			// If we have workspace path mapping, include it in the resolver result
			// This helps VS Code understand the workspace identity for MRU and trust
			if (connection.localWorkspacePath && connection.remoteWorkspacePath) {
				this.logger.info(`Including workspace path mapping in resolver result: local=${connection.localWorkspacePath}, remote=${connection.remoteWorkspacePath}`);
			}
			// --- End Positron ---

			// Return ResolverResult with environment variables
			// Note: We rely on getCanonicalURI mapping to let VS Code recognize
			// that the remote workspace maps to the local workspace for trust and MRU
			return Object.assign(resolvedAuthority, options);

		} catch (error) {
			this.logger.error(`Failed to resolve authority: ${authority}`, error);

			// Create a descriptive error message for the user
			const errorMessage = error instanceof Error ? error.message : String(error);
			// Extract the first meaningful line
			const shortMessage = errorMessage.split('\n')[0];

			// Show a single error notification with action to view logs
			// This replaces VSCode's default error dialog
			const fullMessage = `Failed to connect to container: ${shortMessage}. Check the "Dev Containers" output for details.`;

			// Show the output channel to help users debug
			this.logger.show();

			throw vscode.RemoteAuthorityResolverError.TemporarilyNotAvailable(
				fullMessage
			);
		}
	}

	/**
	 * Get the canonical URI for a resource
	 * This allows remapping URIs between local and remote, and is critical for:
	 * - Workspace trust: Maps remote paths to local paths so trust is preserved
	 * - MRU entries: Ensures local paths are displayed instead of container paths
	 */
	getCanonicalURI(uri: vscode.Uri): vscode.ProviderResult<vscode.Uri> {
		// --- Start Positron ---
		// IMPORTANT: For workspace trust and MRU to work correctly, we need to return
		// the LOCAL file:// URI as the canonical form of the remote URI.
		// This tells VS Code that vscode-remote://dev-container+xxx/workspaces/foo
		// and file:///Users/projects/foo are the SAME workspace.

		this.logger.debug(`getCanonicalURI called: scheme=${uri.scheme}, authority=${uri.authority}, path=${uri.path}`);

		if (uri.scheme === 'vscode-remote') {
			// Remote -> Local mapping
			// Look up workspace path from storage (synchronous from in-memory cache)
			const decoded = decodeDevContainerAuthority(uri.authority);
			if (!decoded?.containerId) {
				this.logger.debug('Failed to decode container ID from authority');
				return uri;
			}

			// Try to get workspace mapping from storage
			try {
				const storage = WorkspaceMappingStorage.getInstance();
				const mapping = storage.get(decoded.containerId);

				if (mapping?.localWorkspacePath && mapping?.remoteWorkspacePath) {
					const normalizedRemote = mapping.remoteWorkspacePath.replace(/\\/g, '/');
					const normalizedUriPath = uri.path.replace(/\\/g, '/');

					this.logger.debug(`Checking mapping: remote=${normalizedRemote}, uri=${normalizedUriPath}`);

					if (normalizedUriPath === normalizedRemote || normalizedUriPath.startsWith(normalizedRemote + '/')) {
						// This URI points to the workspace folder or a file inside it
						const relativePath = normalizedUriPath.substring(normalizedRemote.length);
						const localPath = mapping.localWorkspacePath.replace(/\\/g, '/') + relativePath;

						const fileUri = vscode.Uri.file(localPath);
						this.logger.info(`Remapping remote to local (from storage): ${uri.toString()} -> ${fileUri.toString()}`);

						// Return file URI for workspace trust and MRU
						// This is the KEY to making workspace trust and MRU work correctly
						return fileUri;
					}
				} else {
					this.logger.debug(`No workspace mapping found for container ${decoded.containerId}`);
				}
			} catch (error) {
				this.logger.warn('Failed to get workspace mapping from storage', error);
				// Fall through to return original URI
			}

			// Fallback: try connection info (for backwards compatibility during transition)
			const connection = this.connectionManager.getConnection(decoded.containerId);
			if (connection?.localWorkspacePath && connection?.remoteWorkspacePath) {
				const normalizedRemote = connection.remoteWorkspacePath.replace(/\\/g, '/');
				const normalizedUriPath = uri.path.replace(/\\/g, '/');

				if (normalizedUriPath === normalizedRemote || normalizedUriPath.startsWith(normalizedRemote + '/')) {
					const relativePath = normalizedUriPath.substring(normalizedRemote.length);
					const localPath = connection.localWorkspacePath.replace(/\\/g, '/') + relativePath;

					this.logger.debug(`Remapping remote to local (from connection): ${uri.path} -> ${localPath}`);
					return vscode.Uri.file(localPath);
				}
			}

			return uri;
		}

		if (uri.scheme === 'file') {
			// Local -> Remote mapping
			// Check all active connections to see if this file is inside a mapped workspace
			for (const connection of this.connectionManager.getAllConnections()) {
				if (!connection.localWorkspacePath || !connection.remoteWorkspacePath) {
					continue;
				}

				const normalizedLocal = connection.localWorkspacePath.replace(/\\/g, '/');
				const normalizedUriPath = uri.path.replace(/\\/g, '/');

				if (normalizedUriPath === normalizedLocal || normalizedUriPath.startsWith(normalizedLocal + '/')) {
					// This file is inside a dev container workspace
					const relativePath = normalizedUriPath.substring(normalizedLocal.length);
					const remotePath = connection.remoteWorkspacePath + relativePath;

					this.logger.debug(`Remapping local to remote: ${uri.path} -> ${remotePath}`);

					// Return remote URI
					const authority = `dev-container+${connection.containerId}`;
					return vscode.Uri.parse(`vscode-remote://${authority}${remotePath}`);
				}
			}

			// No mapping found, return as-is
			return uri;
		}

		// Unknown scheme, no remapping
		return uri;
		// --- End Positron ---
	}

	/**
	 * Parse an authority string into its components
	 */
	private parseAuthority(authority: string): ParsedAuthority {
		// Expected format: dev-container+<containerId>[+<encodedPath>] or attached-container+<containerId>

		if (authority.startsWith('dev-container+')) {
			// Use the decoding function to properly extract just the container ID
			const decoded = decodeDevContainerAuthority(authority);
			if (!decoded) {
				throw new Error(`Invalid dev-container authority format: ${authority}`);
			}
			return {
				type: AuthorityType.DevContainer,
				containerId: decoded.containerId,
				raw: authority
			};
		}

		if (authority.startsWith('attached-container+')) {
			return {
				type: AuthorityType.AttachedContainer,
				containerId: authority.substring('attached-container+'.length),
				raw: authority
			};
		}

		throw new Error(`Invalid authority format: ${authority}. Expected format: dev-container+<id> or attached-container+<id>`);
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		// Cleanup handled by ConnectionManager
	}
}

/**
 * Authority utilities
 */
export class AuthorityUtils {
	/**
	 * Create a dev container authority string
	 */
	static createDevContainerAuthority(containerId: string): string {
		return `dev-container+${containerId}`;
	}

	/**
	 * Create an attached container authority string
	 */
	static createAttachedContainerAuthority(containerId: string): string {
		return `attached-container+${containerId}`;
	}

	/**
	 * Extract container ID from authority
	 */
	static extractContainerId(authority: string): string | undefined {
		if (authority.startsWith('dev-container+')) {
			const decoded = decodeDevContainerAuthority(authority);
			return decoded?.containerId;
		}
		if (authority.startsWith('attached-container+')) {
			return authority.substring('attached-container+'.length);
		}
		return undefined;
	}

	/**
	 * Check if an authority is a dev container
	 */
	static isDevContainerAuthority(authority: string): boolean {
		return authority.startsWith('dev-container+');
	}

	/**
	 * Check if an authority is an attached container
	 */
	static isAttachedContainerAuthority(authority: string): boolean {
		return authority.startsWith('attached-container+');
	}

	/**
	 * Check if an authority is any container authority
	 */
	static isContainerAuthority(authority: string): boolean {
		return this.isDevContainerAuthority(authority) || this.isAttachedContainerAuthority(authority);
	}
}
