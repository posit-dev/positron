/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as ai from 'ai';
import { log } from './extension.js';

export interface SnowflakeProviderVariables {
	SNOWFLAKE_ACCOUNT?: string;
	SNOWFLAKE_HOME?: string;
}

/**
 * Configuration for detected Snowflake credentials
 */
export interface SnowflakeCredentialConfig {
	token: string;
	baseUrl: string;
	account: string;
}

/**
 * Result of checking for credential updates
 */
export interface CredentialUpdateResult {
	/** Whether credentials were updated */
	updated: boolean;
	/** New credentials if updated, undefined otherwise */
	credentials?: SnowflakeCredentialConfig;
	/** New last modified timestamp to track */
	lastModified: number;
}

/**
 * Validates a Snowflake account identifier format
 * @param account Account identifier to validate
 * @returns True if the account format is valid
 */
export function isValidSnowflakeAccount(account: string): boolean {
	if (!account || typeof account !== 'string') {
		return false;
	}

	// Snowflake accounts follow pattern: orgname-accountname or legacy format
	return /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(account) ||
		/^[a-zA-Z0-9_-]+$/.test(account);
}

/**
 * Constructs a Snowflake Cortex API base URL from an account identifier
 * @param account Snowflake account identifier
 * @returns Base URL for Cortex API
 */
export function constructSnowflakeBaseUrl(account: string): string {
	if (!isValidSnowflakeAccount(account)) {
		throw new Error(`Invalid Snowflake account identifier: ${account}`);
	}
	return `https://${account}.snowflakecomputing.com/api/v2/cortex/v1`;
}

/**
 * Extracts account and token from Posit Workbench-managed connections.toml
 * @param connectionsTomlPath Full path to the connections.toml file
 * @returns Object with account and token, or null if not found
 */
function extractCredentialsFromToml(connectionsTomlPath: string): { account: string; token: string } | null {
	try {
		if (!fs.existsSync(connectionsTomlPath)) {
			return null;
		}

		const cfg = fs.readFileSync(connectionsTomlPath, 'utf8').split('\n');
		let account = '';
		let token = '';

		// Try to get the token
		const tokenLine = cfg.find(line => line.includes('token = '));
		if (!tokenLine) {
			log.warn('[Snowflake Auth] No token found in connections.toml');
		}
		token = tokenLine ? tokenLine.replace('token = ', '').trim().replace(/"/g, '') : '';

		// Try to get the account
		const accountLine = cfg.find(line => line.includes('account = '));
		if (!accountLine) {
			log.warn('[Snowflake Auth] No account identifier found in connections.toml');
		}
		account = accountLine ? accountLine.replace('account = ', '').trim().replace(/"/g, '') : '';

		if (account && token) {
			return { account, token };
		}

		return null;
	} catch (error) {
		log.debug(`[Snowflake Auth] Error extracting account and token from TOML: ${error}`);
		return null;
	}
}

/**
 * Detects Snowflake credentials from Posit Workbench managed connections.toml
 * @returns Configuration object with detected credentials or undefined if none found
 */
export async function detectSnowflakeCredentials(): Promise<SnowflakeCredentialConfig | undefined> {
	const connectionsTomlPath = getSnowflakeConnectionsTomlPath();
	if (!connectionsTomlPath) {
		log.debug('[Snowflake Auth] No Posit Workbench managed credentials detected');
		return undefined;
	}

	// For credential detection, we parse the connections.toml file to extract both account and token
	const result = extractCredentialsFromToml(connectionsTomlPath);
	if (result && result.token) {
		log.info(`[Snowflake Auth] Using Posit Workbench managed credentials for account: ${result.account}`);
		return {
			token: result.token,
			account: result.account,
			baseUrl: constructSnowflakeBaseUrl(result.account)
		};
	}

	log.debug('[Snowflake Auth] No Posit Workbench managed credentials detected');
	return undefined;
}

/**
 * Gets the path to the connections.toml file for monitoring
 * @param logPath Whether to log the path for debugging (default: false)
 * @returns Path to connections.toml or undefined if not available
 */
export function getSnowflakeConnectionsTomlPath(): string | undefined {
	try {
		const configSettings = vscode.workspace.getConfiguration('positron.assistant.providerVariables').get<SnowflakeProviderVariables>('snowflake', {});
		const snowflakeHome = configSettings.SNOWFLAKE_HOME || process.env.SNOWFLAKE_HOME;

		if (snowflakeHome) {
			return path.join(snowflakeHome, 'connections.toml');
		}

		log.warn('[Snowflake Auth] No SNOWFLAKE_HOME configured - unable to determine connections.toml path');
		return undefined;
	} catch (error) {
		log.warn(`[Snowflake Auth] Failed to get connections.toml path: ${error}`);
		return undefined;
	}
}

/**
 * Check if connections.toml has been modified since the last check and return updated credentials if available
 * @param lastCheck Timestamp of the last check (undefined for first check)
 * @param currentToken Current token to compare against
 * @returns Result indicating whether credentials were updated
 */
export async function checkForUpdatedSnowflakeCredentials(
	lastCheck: number | undefined,
	currentToken: string
): Promise<CredentialUpdateResult> {
	const connectionsTomlPath = getSnowflakeConnectionsTomlPath();
	if (!connectionsTomlPath) {
		// No path to check - return unchanged
		return {
			updated: false,
			lastModified: lastCheck || Date.now()
		};
	}

	try {
		const stats = await fs.promises.stat(connectionsTomlPath);
		const lastModified = stats.mtime.getTime();

		// If this is our first check or the file has been modified, read new credentials
		if (!lastCheck || lastModified > lastCheck) {
			log.debug('[Snowflake Auth] connections.toml modified, checking for updated credentials');

			const credentials = await detectSnowflakeCredentials();
			if (credentials?.token && credentials.token !== currentToken) {
				log.info(`[Snowflake Auth] Found updated credentials for account: ${credentials.account}`);
				return {
					updated: true,
					credentials,
					lastModified
				};
			}

			// File was modified but credentials didn't change
			return {
				updated: false,
				lastModified
			};
		}

		// File hasn't been modified
		return {
			updated: false,
			lastModified: lastCheck
		};
	} catch (error) {
		// File might not exist or be readable, which is fine
		log.debug(`[Snowflake Auth] Could not check connections.toml modification time: ${error}`);
		return {
			updated: false,
			lastModified: lastCheck || Date.now()
		};
	}
}

/**
 * Gets the default base URL for Snowflake Cortex, using SNOWFLAKE_ACCOUNT if available
 * @returns Base URL string with account identifier filled in if possible
 */
export function getSnowflakeDefaultBaseUrl(): string {
	// Try to get the account from environment variables or configuration
	const configSettings = vscode.workspace.getConfiguration('positron.assistant.providerVariables').get<SnowflakeProviderVariables>('snowflake', {});
	const account = configSettings.SNOWFLAKE_ACCOUNT || process.env.SNOWFLAKE_ACCOUNT;

	if (account) {
		try {
			return constructSnowflakeBaseUrl(account);
		} catch (error) {
			// If account is invalid, fall back to placeholder
			log.debug(`[Snowflake] Invalid account identifier '${account}', using placeholder: ${error}`);
		}
	}

	// Fallback to placeholder if no account is available
	return 'https://<account_identifier>.snowflakecomputing.com/api/v2/cortex/v1';
}

/**
 * Extracts Snowflake-specific error messages with enhanced user guidance.
 * Returns the enhanced error message if this is a Snowflake-specific error, or undefined otherwise.
 * @param error The error object to check.
 * @returns Enhanced Snowflake error message or undefined.
 */
export function extractSnowflakeError(error: any): string | undefined {
	// Get error message from various error formats
	let errorMessage = '';

	if (ai.APICallError.isInstance(error) && error.responseBody) {
		try {
			const parsed = JSON.parse(error.responseBody);
			errorMessage = parsed?.error?.message || error.responseBody;
		} catch {
			errorMessage = error.responseBody;
		}
	} else {
		errorMessage = error?.message || String(error);
	}

	// Detect cross-region inference issues
	const isCrossRegionError =
		errorMessage.toLowerCase().includes('cross-region') ||
		errorMessage.toLowerCase().includes('region mismatch') ||
		errorMessage.toLowerCase().includes('not available in the current region') ||
		errorMessage.toLowerCase().includes('model not available') ||
		(error?.statusCode === 403 && errorMessage.toLowerCase().includes('region')) ||
		(error?.statusCode === 404 && errorMessage.toLowerCase().includes('model'));

	// Detect network policy issues
	const isNetworkPolicyError =
		errorMessage.toLowerCase().includes('network policy') ||
		errorMessage.toLowerCase().includes('network policy is required');

	if (isCrossRegionError || isNetworkPolicyError) {
		// Create enhanced message based on error type
		const statusCode = error?.statusCode || error?.status || 'Unknown';

		if (isNetworkPolicyError && isCrossRegionError) {
			// Both error types detected - treat as general Snowflake configuration issue
			return `Snowflake Configuration Issue: Your Snowflake account configuration is preventing access to AI models. This appears to involve both network policies and cross-region settings. Contact your Snowflake administrator. Response Status: ${statusCode}. Technical Details: ${errorMessage}`;
		} else if (isNetworkPolicyError) {
			return `Snowflake Network Policy Issue: Your Snowflake account requires network policy configuration for AI model access. Contact your Snowflake administrator. Response Status: ${statusCode}. Details: ${errorMessage}`;
		} else {
			return `Snowflake Cross-Region Issue: The AI model may not be available in your Snowflake account's region. Contact your Snowflake administrator. Response Status: ${statusCode}. Details: ${errorMessage}`;
		}
	}

	return undefined;
}
