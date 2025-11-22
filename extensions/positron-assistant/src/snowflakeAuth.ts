/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as vscode from 'vscode';
import { log } from './extension.js';
import { AutoconfigureResult } from './models.js';
import { IS_RUNNING_ON_PWB } from './constants.js';

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

		// Normalize underscores to hyphens before checking
		const normalizedAccount = account.replace(/_/g, '-');

		// Simple parsing - check if account matches and extract token
		// We don't attempt full TOML parsing, following ellmer's approach
		if (!cfg.some(line => line.includes(normalizedAccount))) {
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
 * Detects Snowflake credentials from Posit Workbench managed connections.toml
 * @returns Configuration object with detected credentials or undefined if none found
 */
export async function detectSnowflakeCredentials(): Promise<SnowflakeCredentialConfig | undefined> {
	// Get configuration from VS Code settings (similar to Bedrock)
	const configSettings = vscode.workspace.getConfiguration('positron.assistant.providerVariables').get<SnowflakeProviderVariables>('snowflake', {});
	log.debug(`[Snowflake Auth] positron.assistant.providerVariables.snowflake settings: ${JSON.stringify(configSettings)}`);

	// Merge environment variables with settings
	const { SNOWFLAKE_ACCOUNT, SNOWFLAKE_HOME } = { ...process.env as SnowflakeProviderVariables, ...configSettings };

	// Only look for Posit Workbench managed connections.toml
	if (SNOWFLAKE_HOME && SNOWFLAKE_ACCOUNT && SNOWFLAKE_HOME.includes('posit-workbench')) {
		const token = readWorkbenchSnowflakeToken(SNOWFLAKE_ACCOUNT, SNOWFLAKE_HOME);
		if (token) {
			log.info(`[Snowflake Auth] Using Posit Workbench managed credentials for account: ${SNOWFLAKE_ACCOUNT}`);
			return {
				token: token,
				account: SNOWFLAKE_ACCOUNT,
				baseUrl: constructSnowflakeBaseUrl(SNOWFLAKE_ACCOUNT)
			};
		}
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
 * Autoconfigure function for Snowflake Cortex following the managed credentials pattern
 * @param displayName - The provider display name for logging
 * @returns A promise that resolves to the autoconfigure result
 */
export async function autoconfigureSnowflakeCredentials(
	displayName: string
): Promise<AutoconfigureResult> {
	try {
		// Only autoconfigure on Posit Workbench
		if (!IS_RUNNING_ON_PWB) {
			return { signedIn: false };
		}

		const detected = await detectSnowflakeCredentials();

		if (detected) {
			log.info(`[${displayName}] Auto-configuring with Posit Workbench managed credentials`);
			return {
				signedIn: true,
				message: 'Posit Workbench managed credentials',
				token: detected.token
			};
		}

		return { signedIn: false };
	} catch (error) {
		log.error(`[${displayName}] Error during autoconfiguration: ${error}`);
		return { signedIn: false };
	}
}
