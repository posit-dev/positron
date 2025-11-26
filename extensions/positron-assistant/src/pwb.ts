/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getEnabledProviders } from './config';
import { IS_RUNNING_ON_PWB } from './constants';
import { log } from './extension';
import { AutoconfigureResult } from './models.js';

/**
 * Configuration for managed credentials on Posit Workbench.
 */
export interface ManagedCredentialConfig {
	/** Display name for the credential type shown to users */
	readonly displayName: string;
	/** Environment variable name that indicates managed credentials are available */
	readonly envVar: string;
	/** Validator function to confirm the env var value for managed credentials */
	readonly validator: (value: string) => boolean;
	/** Optional provider variable configuration key for VS Code settings */
	readonly providerVariableKey?: string;
}

/**
 * AWS managed credentials configuration for Posit Workbench.
 */
export const AWS_MANAGED_CREDENTIALS: ManagedCredentialConfig = {
	displayName: 'AWS managed credentials',
	envVar: 'AWS_WEB_IDENTITY_TOKEN_FILE',
	providerVariableKey: 'bedrock',
	validator: (value: string) => value.includes('posit-workbench'),
};

/**
 * Snowflake managed credentials configuration for Posit Workbench.
 */
export const SNOWFLAKE_MANAGED_CREDENTIALS: ManagedCredentialConfig = {
	displayName: 'OAuth (Managed)',
	envVar: 'SNOWFLAKE_HOME',
	providerVariableKey: 'snowflake',
	validator: (value: string) => value.includes('posit-workbench'),
};

/**
 * Helper function to autoconfigure language models using managed credentials on Posit Workbench.
 *
 * @template T - The credential configuration type (e.g., typeof AWS_MANAGED_CREDENTIALS)
 * @param credentialConfig - The credential configuration to check
 * @param providerId - The provider ID to check if enabled
 * @param displayName - The provider display name for logging
 * @param tokenExtractor - Optional function to extract the actual token from the environment
 * @returns A promise that resolves to the autoconfigure result
 */
export async function autoconfigureWithManagedCredentials<T extends ManagedCredentialConfig>(
	credentialConfig: T,
	providerId: string,
	displayName: string,
	tokenExtractor?: () => Promise<string | undefined>
): Promise<AutoconfigureResult> {
	// Configure automatically if:
	// - We are on PWB, and
	// - the provider is enabled in settings, and
	// - managed credentials are available

	if (!IS_RUNNING_ON_PWB) {
		log.debug(`[${displayName}] Not running on Posit Workbench, skipping autoconfigure`);
		return { signedIn: false };
	}

	const providerEnabled = await getEnabledProviders().then(
		providers => providers.includes(providerId)
	);
	if (!providerEnabled) {
		log.debug(`[${displayName}] Provider '${providerId}' not enabled in settings`);
		return { signedIn: false };
	}

	// Check for managed credentials using the provided config
	let tokenEnv = process.env[credentialConfig.envVar];

	// Also check provider variables if configured
	if (!tokenEnv && credentialConfig.providerVariableKey) {
		const configSettings = vscode.workspace.getConfiguration('positron.assistant.providerVariables').get<Record<string, any>>(credentialConfig.providerVariableKey, {});
		tokenEnv = configSettings[credentialConfig.envVar];
		log.debug(`[${displayName}] Checked provider variables for ${credentialConfig.envVar}: ${tokenEnv ? 'found' : 'not found'}`);
	}

	if (!tokenEnv || !credentialConfig.validator(tokenEnv)) {
		log.debug(`[${displayName}] Managed credentials not available: ${credentialConfig.envVar}=${tokenEnv ? 'set but invalid' : 'not set'}`);
		return { signedIn: false };
	}

	log.info(`[${displayName}] Auto-configuring with managed credentials`);

	// Extract token if tokenExtractor is provided
	let token: string | undefined;
	if (tokenExtractor) {
		token = await tokenExtractor();
		if (!token) {
			log.warn(`[${displayName}] Token extraction failed despite valid environment`);
			return { signedIn: false };
		}
		log.debug(`[${displayName}] Token extracted successfully`);
	}

	return {
		signedIn: true,
		message: credentialConfig.displayName,
		...(token && { token })
	};
}
