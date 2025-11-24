/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as vscode from 'vscode';
import * as ai from 'ai';
import { log } from './extension.js';
import { SNOWFLAKE_MANAGED_CREDENTIALS } from './pwb.js';

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
 * @param snowflakeHome Path to SNOWFLAKE_HOME directory
 * @returns Object with account and token, or null if not found
 */
function extractAccountAndTokenFromToml(snowflakeHome: string): { account: string; token: string } | null {
	try {
		const configPath = `${snowflakeHome}/connections.toml`;
		if (!fs.existsSync(configPath)) {
			return null;
		}

		const cfg = fs.readFileSync(configPath, 'utf8').split('\n');

		// Find the token line first
		const tokenLine = cfg.find(line => line.includes('token = '));
		if (!tokenLine) {
			return null;
		}

		let token = tokenLine.replace('token = ', '').trim();
		if (token.length === 0) {
			return null;
		}

		// Drop enclosing quotes
		token = token.replace(/"/g, '');

		// Find account identifier in the file - look for patterns that look like account identifiers
		// This could be in various formats like account = "..." or in URLs
		let account: string | null = null;

		// Look for explicit account setting
		const accountLine = cfg.find(line => line.includes('account = '));
		if (accountLine) {
			account = accountLine.replace('account = ', '').trim().replace(/"/g, '');
		}

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
	// Get configuration from VS Code settings (similar to Bedrock)
	const configSettings = vscode.workspace.getConfiguration('positron.assistant.providerVariables').get<SnowflakeProviderVariables>('snowflake', {});
	log.debug(`[Snowflake Auth] positron.assistant.providerVariables.snowflake settings: ${JSON.stringify(configSettings)}`);

	// Merge environment variables with settings
	const { SNOWFLAKE_HOME } = { ...process.env as SnowflakeProviderVariables, ...configSettings };

	if (!SNOWFLAKE_HOME) {
		log.debug('[Snowflake Auth] No Posit Workbench managed credentials detected');
		return undefined;
	}

	// For credential detection, we parse the connections.toml file to extract both account and token
	const result = extractAccountAndTokenFromToml(SNOWFLAKE_HOME);
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
