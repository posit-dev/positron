/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import { getLogger } from '../common/logger';

/**
 * Connection token manager
 * Handles generation and validation of secure connection tokens
 */
export class ConnectionTokenManager {
	private static instance: ConnectionTokenManager;
	private logger = getLogger();

	// Store active tokens (in-memory, per session)
	private activeTokens: Map<string, TokenInfo> = new Map();

	private constructor() { }

	/**
	 * Get the singleton instance
	 */
	public static getInstance(): ConnectionTokenManager {
		if (!ConnectionTokenManager.instance) {
			ConnectionTokenManager.instance = new ConnectionTokenManager();
		}
		return ConnectionTokenManager.instance;
	}

	/**
	 * Generate a new secure connection token
	 * @param containerId Container ID this token is for
	 * @returns The generated token string
	 */
	public generateToken(containerId: string): string {
		// Generate a cryptographically secure random token
		// Using 32 bytes (256 bits) for strong security
		const tokenBytes = crypto.randomBytes(32);
		const token = tokenBytes.toString('hex');

		// Store token info
		this.activeTokens.set(token, {
			containerId,
			createdAt: new Date(),
			lastUsed: new Date()
		});

		this.logger.debug(`Generated connection token for container ${containerId}`);

		return token;
	}

	/**
	 * Validate a connection token
	 * @param token Token to validate
	 * @param containerId Container ID to validate against
	 * @returns True if token is valid, false otherwise
	 */
	public validateToken(token: string, containerId: string): boolean {
		const tokenInfo = this.activeTokens.get(token);

		if (!tokenInfo) {
			this.logger.warn(`Token validation failed: token not found`);
			return false;
		}

		if (tokenInfo.containerId !== containerId) {
			this.logger.warn(`Token validation failed: container ID mismatch`);
			return false;
		}

		// Update last used time
		tokenInfo.lastUsed = new Date();

		this.logger.debug(`Token validated successfully for container ${containerId}`);
		return true;
	}

	/**
	 * Get token info
	 * @param token Token to get info for
	 * @returns Token info or undefined if not found
	 */
	public getTokenInfo(token: string): TokenInfo | undefined {
		return this.activeTokens.get(token);
	}

	/**
	 * Revoke a token
	 * @param token Token to revoke
	 */
	public revokeToken(token: string): void {
		const tokenInfo = this.activeTokens.get(token);
		if (tokenInfo) {
			this.activeTokens.delete(token);
			this.logger.debug(`Revoked token for container ${tokenInfo.containerId}`);
		}
	}

	/**
	 * Revoke all tokens for a container
	 * @param containerId Container ID
	 */
	public revokeTokensForContainer(containerId: string): void {
		const tokensToRevoke: string[] = [];

		// Convert to array to avoid iterator issues
		const entries = Array.from(this.activeTokens.entries());
		for (const [token, info] of entries) {
			if (info.containerId === containerId) {
				tokensToRevoke.push(token);
			}
		}

		for (const token of tokensToRevoke) {
			this.activeTokens.delete(token);
		}

		if (tokensToRevoke.length > 0) {
			this.logger.debug(`Revoked ${tokensToRevoke.length} token(s) for container ${containerId}`);
		}
	}

	/**
	 * Clean up expired tokens
	 * Removes tokens that haven't been used in the specified time period
	 * @param maxAgeMs Maximum age in milliseconds (default: 24 hours)
	 */
	public cleanupExpiredTokens(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
		const now = new Date();
		const tokensToRevoke: string[] = [];

		// Convert to array to avoid iterator issues
		const entries = Array.from(this.activeTokens.entries());
		for (const [token, info] of entries) {
			const ageMs = now.getTime() - info.lastUsed.getTime();
			if (ageMs > maxAgeMs) {
				tokensToRevoke.push(token);
			}
		}

		for (const token of tokensToRevoke) {
			this.activeTokens.delete(token);
		}

		if (tokensToRevoke.length > 0) {
			this.logger.debug(`Cleaned up ${tokensToRevoke.length} expired token(s)`);
		}
	}

	/**
	 * Get all active tokens (for debugging)
	 */
	public getActiveTokenCount(): number {
		return this.activeTokens.size;
	}

	/**
	 * Clear all tokens (for testing/cleanup)
	 */
	public clearAllTokens(): void {
		const count = this.activeTokens.size;
		this.activeTokens.clear();
		this.logger.debug(`Cleared all ${count} token(s)`);
	}
}

/**
 * Token information
 */
interface TokenInfo {
	/**
	 * Container ID this token is for
	 */
	containerId: string;

	/**
	 * When the token was created
	 */
	createdAt: Date;

	/**
	 * When the token was last used
	 */
	lastUsed: Date;
}

/**
 * Get connection token manager instance
 */
export function getConnectionTokenManager(): ConnectionTokenManager {
	return ConnectionTokenManager.getInstance();
}

/**
 * Generate a new connection token for a container
 * @param containerId Container ID
 * @returns Generated token
 */
export function generateConnectionToken(containerId: string): string {
	return getConnectionTokenManager().generateToken(containerId);
}

/**
 * Validate a connection token
 * @param token Token to validate
 * @param containerId Container ID
 * @returns True if valid, false otherwise
 */
export function validateConnectionToken(token: string, containerId: string): boolean {
	return getConnectionTokenManager().validateToken(token, containerId);
}

/**
 * Revoke a connection token
 * @param token Token to revoke
 */
export function revokeConnectionToken(token: string): void {
	getConnectionTokenManager().revokeToken(token);
}
