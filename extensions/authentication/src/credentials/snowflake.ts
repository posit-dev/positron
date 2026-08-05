/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AuthProviderLogger } from '../authProviderLogger';

const logger = new AuthProviderLogger('Snowflake Auth');

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
 * Expands tilde (~) in file paths to the user's home directory
 * @param filePath Path that may contain a tilde
 * @returns Expanded path with tilde resolved to home directory
 */
function expandTildePath(filePath: string): string {
	if (filePath.startsWith('~')) {
		return path.join(os.homedir(), filePath.slice(1));
	}
	return filePath;
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
			logger.error('connections.toml file does not exist. Please ensure SNOWFLAKE_HOME is set correctly.');
			return null;
		}

		const cfg = fs.readFileSync(connectionsTomlPath, 'utf8').split('\n');
		let account = '';
		let token = '';

		// Try to get the token
		const tokenLine = cfg.find(line => line.includes('token = '));
		if (!tokenLine) {
			logger.warn('No token found in connections.toml');
		}
		token = tokenLine ? tokenLine.replace('token = ', '').trim().replace(/"/g, '') : '';

		// Try to get the account
		const accountLine = cfg.find(line => line.includes('account = '));
		if (!accountLine) {
			logger.warn('No account identifier found in connections.toml');
		}
		account = accountLine ? accountLine.replace('account = ', '').trim().replace(/"/g, '') : '';

		if (account && token) {
			return { account, token };
		}

		logger.error('Incomplete credentials in connections.toml');
		return null;
	} catch (error) {
		logger.debug(`Error extracting account and token from TOML: ${error}`);
		return null;
	}
}

/**
 * Detects Snowflake credentials from Posit Workbench managed connections.toml
 * @param snowflake Catalog `connection.snowflake` slice supplying `home`
 * @returns Configuration object with detected credentials or undefined if none found
 */
export async function detectSnowflakeCredentials(
	snowflake?: { home?: string }
): Promise<SnowflakeCredentialConfig | undefined> {
	const connectionsTomlPath = getSnowflakeConnectionsTomlPath(snowflake);
	if (!connectionsTomlPath) {
		logger.debug('No Posit Workbench managed credentials detected');
		return undefined;
	}

	// For credential detection, we parse the connections.toml file to extract both account and token
	const result = extractCredentialsFromToml(connectionsTomlPath);
	if (result && result.token) {
		logger.info(`Using Posit Workbench managed credentials for account: ${result.account}`);
		return {
			token: result.token,
			account: result.account,
			baseUrl: constructSnowflakeBaseUrl(result.account)
		};
	}

	logger.debug('Failed to extract valid Snowflake credentials from connections.toml');
	return undefined;
}

/**
 * Gets the path to the connections.toml file for monitoring
 * @param snowflake Catalog `connection.snowflake` slice supplying `home`
 * @returns Path to connections.toml or undefined if not available
 */
export function getSnowflakeConnectionsTomlPath(
	snowflake?: { home?: string }
): string | undefined {
	try {
		const snowflakeHome = snowflake?.home;

		if (snowflakeHome) {
			const expandedHome = expandTildePath(snowflakeHome);
			return path.join(expandedHome, 'connections.toml');
		}

		logger.warn('No SNOWFLAKE_HOME configured - unable to determine connections.toml path');
		return undefined;
	} catch (error) {
		logger.warn(`Failed to get connections.toml path: ${error}`);
		return undefined;
	}
}

/**
 * Reads the Snowflake account identifier from the provider catalog's
 * `connection.snowflake` slice.
 * @param snowflake Catalog `connection.snowflake` slice supplying `account`
 * @returns The account identifier, or an empty string if not set.
 */
export function getConfiguredSnowflakeAccount(
	snowflake?: { account?: string }
): string {
	return snowflake?.account || '';
}
