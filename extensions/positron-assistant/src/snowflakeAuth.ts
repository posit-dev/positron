/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as vscode from 'vscode';
import { log } from './extension.js';
import { AutoconfigureResult } from './models.js';

export interface SnowflakeProviderVariables {
	SNOWFLAKE_ACCOUNT?: string;
	SNOWFLAKE_HOME?: string;
}

/**
 * Configuration for detected Snowflake credentials
 */
export interface SnowflakeCredentialConfig {
	apiKey: string;
	baseUrl: string;
	account: string;
	source: 'environment' | 'connections.toml';
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
 * Reads Posit Workbench-managed Snowflake credentials from connections.toml
 * Similar to ellmer's workbench_snowflake_token function
 * @param account Snowflake account identifier
 * @param snowflakeHome Path to SNOWFLAKE_HOME directory
 * @returns OAuth token or null if not found
 */
function readWorkbenchSnowflakeToken(account: string, snowflakeHome: string): string | null {
	try {
		const configPath = `${snowflakeHome}/connections.toml`;
		if (!fs.existsSync(configPath)) {
			return null;
		}

		const cfg = fs.readFileSync(configPath, 'utf8').split('\n');

		// Simple parsing - check if account matches and extract token
		// We don't attempt full TOML parsing, following ellmer's approach
		if (!cfg.some(line => line.includes(account))) {
			// The configuration doesn't actually apply to this account
			return null;
		}

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
		return token;
	} catch (error) {
		log.debug(`[Snowflake Auth] Error reading workbench token: ${error}`);
		return null;
	}
}

/**
 * Detects Snowflake credentials from environment variables and connections.toml
 * Following ellmer's credential detection priority
 * @returns Configuration object with detected credentials or undefined if none found
 */
export async function detectSnowflakeCredentials(): Promise<SnowflakeCredentialConfig | undefined> {
	// Get configuration from VS Code settings (similar to Bedrock)
	const configSettings = vscode.workspace.getConfiguration('positron.assistant.providerVariables').get<SnowflakeProviderVariables>('snowflake', {});
	log.debug(`[Snowflake Auth] positron.assistant.providerVariables.snowflake settings: ${JSON.stringify(configSettings)}`);

	// Merge environment variables with settings (env vars take precedence)
	// Note: SNOWFLAKE_TOKEN only comes from environment for security
	const { SNOWFLAKE_ACCOUNT, SNOWFLAKE_HOME } = { ...configSettings, ...process.env as SnowflakeProviderVariables };
	const SNOWFLAKE_TOKEN = process.env.SNOWFLAKE_TOKEN; // Token only from env vars

	// Priority 1: Static OAuth token via SNOWFLAKE_TOKEN + SNOWFLAKE_ACCOUNT
	const envToken = SNOWFLAKE_TOKEN;
	const envAccount = SNOWFLAKE_ACCOUNT;

	if (envToken && envAccount && isValidSnowflakeAccount(envAccount)) {
		log.info('[Snowflake Auth] Using SNOWFLAKE_TOKEN environment variable');
		return {
			apiKey: envToken,
			account: envAccount,
			baseUrl: constructSnowflakeBaseUrl(envAccount),
			source: 'environment'
		};
	}

	// Priority 2: connections.toml file (Posit Workbench or local testing)
	if (SNOWFLAKE_HOME && envAccount) {
		const token = readWorkbenchSnowflakeToken(envAccount, SNOWFLAKE_HOME);
		if (token) {
			const source = SNOWFLAKE_HOME.includes('posit-workbench') ? 'Posit Workbench managed credentials' : 'local connections.toml';
			log.info(`[Snowflake Auth] Using ${source} for account: ${envAccount}`);
			return {
				apiKey: token,
				account: envAccount,
				baseUrl: constructSnowflakeBaseUrl(envAccount),
				source: 'connections.toml'
			};
		}
	}

	log.debug('[Snowflake Auth] No credentials detected from environment or connections.toml');
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
 * Autoconfigure function for Snowflake Cortex following the managed credentials pattern
 * @param providerId - The provider ID to check if enabled
 * @param displayName - The provider display name for logging
 * @returns A promise that resolves to the autoconfigure result
 */
export async function autoconfigureSnowflakeCredentials(
	providerId: string,
	displayName: string
): Promise<AutoconfigureResult> {
	try {
		const detected = await detectSnowflakeCredentials();

		if (detected) {
			log.info(`[${displayName}] Auto-configuring with ${detected.source} credentials`);
			return {
				signedIn: true,
				message: detected.source === 'connections.toml'
					? 'Posit Workbench managed credentials'
					: 'Environment variables (SNOWFLAKE_TOKEN)'
			};
		}

		return { signedIn: false };
	} catch (error) {
		log.error(`[${displayName}] Error during autoconfiguration: ${error}`);
		return { signedIn: false };
	}
}