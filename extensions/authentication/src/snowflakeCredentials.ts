/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { log } from './log';

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
			log.error('[Snowflake Auth] connections.toml file does not exist. Please ensure SNOWFLAKE_HOME is set correctly.');
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

		log.error('[Snowflake Auth] Incomplete credentials in connections.toml');
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

	log.debug('[Snowflake Auth] Failed to extract valid Snowflake credentials from connections.toml');
	return undefined;
}

/**
 * Gets the path to the connections.toml file for monitoring
 * @returns Path to connections.toml or undefined if not available
 */
export function getSnowflakeConnectionsTomlPath(): string | undefined {
	try {
		const configSettings = vscode.workspace
			.getConfiguration('authentication.snowflake')
			.get<SnowflakeProviderVariables>('credentials', {});
		const snowflakeHome = configSettings.SNOWFLAKE_HOME || process.env.SNOWFLAKE_HOME;

		if (snowflakeHome) {
			const expandedHome = expandTildePath(snowflakeHome);
			return path.join(expandedHome, 'connections.toml');
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
 * Resolves the Snowflake partner tag sent as the User-Agent header on Cortex
 * requests. The tag lets Snowflake attribute traffic to Posit; Workbench-managed
 * environments override it via SF_PARTNER (e.g. `posit_workbench_positron`).
 *
 * Precedence: environmentVariables.set.SF_PARTNER, then process.env.SF_PARTNER,
 * then the default `posit_positron`.
 */
export function getSnowflakePartnerTag(): string {
	const envVars = vscode.workspace
		.getConfiguration('environmentVariables')
		.get<Record<string, string>>('set') ?? {};
	return envVars['SF_PARTNER'] || process.env.SF_PARTNER || 'posit_positron';
}

/**
 * Seeds the Snowflake partner tag into `authentication.snowflake.customHeaders`
 * as the User-Agent header, so Posit Assistant reads it from there instead of
 * redoing the lookup itself.
 *
 * Two rules:
 * - Skip if the user already set User-Agent. customHeaders is the escape
 *   hatch for enterprise gateways, and we don't clobber it.
 * - Write to the scope where customHeaders is currently defined (most
 *   specific wins). Object settings don't merge across scopes, so a global
 *   write can be hidden by a workspace-level value.
 *
 * Seeded once at activation; subsequent SF_PARTNER changes require a reload.
 * Users who need a different tag mid-session can edit
 * authentication.snowflake.customHeaders directly.
 *
 * @returns true if a write was made, false if seeding was skipped.
 */
export async function seedSnowflakePartnerTagHeader(): Promise<boolean> {
	const cfg = vscode.workspace.getConfiguration('authentication.snowflake');
	const effective = cfg.get<Record<string, string>>('customHeaders', {});
	if (effective['User-Agent']) {
		return false;
	}
	const inspection = cfg.inspect<Record<string, string>>('customHeaders');
	let target: vscode.ConfigurationTarget;
	let base: Record<string, string>;
	if (inspection?.workspaceFolderValue !== undefined) {
		target = vscode.ConfigurationTarget.WorkspaceFolder;
		base = inspection.workspaceFolderValue;
	} else if (inspection?.workspaceValue !== undefined) {
		target = vscode.ConfigurationTarget.Workspace;
		base = inspection.workspaceValue;
	} else {
		target = vscode.ConfigurationTarget.Global;
		base = inspection?.globalValue ?? {};
	}
	await cfg.update(
		'customHeaders',
		{ ...base, 'User-Agent': getSnowflakePartnerTag() },
		target
	);
	return true;
}

/**
 * Gets the default base URL for Snowflake Cortex, using SNOWFLAKE_ACCOUNT if available
 * @returns Base URL string with account identifier filled in if possible
 */
export function getSnowflakeDefaultBaseUrl(): string {
	// Prefer a baseUrl previously saved by the user via the config dialog.
	const savedBaseUrl = vscode.workspace
		.getConfiguration('authentication.snowflake-cortex')
		.get<string>('baseUrl');
	if (savedBaseUrl) {
		return savedBaseUrl;
	}

	// Try to get the account from settings or environment variables
	const configSettings = vscode.workspace
		.getConfiguration('authentication.snowflake')
		.get<SnowflakeProviderVariables>('credentials', {});
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
