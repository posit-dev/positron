/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Logger } from '../common/logger';
import { ConnectionManager, ConnectionState } from './connectionManager';

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

		try {
			// Parse the authority
			const parsed = this.parseAuthority(authority);
			this.logger.info(`Parsed authority: type=${parsed.type}, containerId=${parsed.containerId}`);

			// Check for existing connection
			const existing = this.connectionManager.getConnection(parsed.containerId);
			if (existing && existing.state === ConnectionState.Connected) {
				this.logger.info(`Using existing connection to ${parsed.containerId}`);
				return new vscode.ResolvedAuthority(
					existing.host,
					existing.port,
					existing.connectionToken
				);
			}

			// Establish new connection
			this.logger.info(`Establishing new connection to ${parsed.containerId}`);
			const connection = await this.connectionManager.connect(parsed.containerId);

			// Return resolved authority
			const resolvedAuthority = new vscode.ResolvedAuthority(
				connection.host,
				connection.port,
				connection.connectionToken
			);

			this.logger.info(`Authority resolved: ${connection.host}:${connection.port}`);
			return resolvedAuthority;

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
	 * This allows remapping URIs between local and remote
	 */
	getCanonicalURI(uri: vscode.Uri): vscode.ProviderResult<vscode.Uri> {
		// For now, return the URI as-is
		// In the future, we might need to remap paths for certain scenarios
		return uri;
	}

	/**
	 * Parse an authority string into its components
	 */
	private parseAuthority(authority: string): ParsedAuthority {
		// Expected format: dev-container+<containerId> or attached-container+<containerId>

		if (authority.startsWith('dev-container+')) {
			return {
				type: AuthorityType.DevContainer,
				containerId: authority.substring('dev-container+'.length),
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
			return authority.substring('dev-container+'.length);
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
