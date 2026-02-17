/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { IS_RUNNING_ON_PWB } from './constants';
import { log } from './log.js';
import { AutoconfigureResult } from './providers/base/modelProviderTypes.js';

/**
 * Configuration for managed credentials on Posit Workbench.
 */
export interface ManagedCredentialConfig {
	/** Display name for the credential type shown to users */
	readonly displayName: string;
	/** Environment variable name that indicates managed credentials are available.
	 *  Optional when authProvider is set. */
	readonly envVar?: string;
	/** Validator function to confirm the env var value for managed credentials.
	 *  Required when envVar is set. */
	readonly validator?: (value: string) => boolean;
	/** Optional provider variable configuration key for VS Code settings */
	readonly providerVariableKey?: string;
	/** VS Code auth provider for token-based credentials (bearer tokens).
	 *  When set, a successful getSession() is the availability signal
	 *  instead of (or in addition to) the env var check. */
	readonly authProvider?: {
		readonly id: string;
		readonly scopes: string[];
	};
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
 * Azure OpenAI managed credentials configuration for Posit Workbench.
 * Uses the VS Code auth provider instead of environment variables.
 */
export const AZURE_MANAGED_CREDENTIALS: ManagedCredentialConfig = {
	displayName: 'Azure OpenAI (Workbench)',
	authProvider: {
		id: 'posit-workbench',
		scopes: ['azure-cognitiveservices'],
	},
};

/**
 * Helper function to autoconfigure language models using managed credentials on Posit Workbench.
 *
 * @template T - The credential configuration type (e.g., typeof AWS_MANAGED_CREDENTIALS)
 * @param credentialConfig - The credential configuration to check
 * @param providerId - The provider ID to check if enabled
 * @param displayName - The provider display name for logging
 * @returns A promise that resolves to the autoconfigure result
 */
export async function autoconfigureWithManagedCredentials<T extends ManagedCredentialConfig>(
	credentialConfig: T,
	providerId: string,
	displayName: string
): Promise<AutoconfigureResult> {
	// Configure automatically if:
	// - the provider is enabled in settings, and
	// - we are on PWB, and
	// - managed credentials are available

	const enabledProviders = await positron.ai.getEnabledProviders();
	const providerEnabled = enabledProviders.includes(providerId);
	if (!providerEnabled) {
		log.debug(`[${displayName}] Provider '${providerId}' not enabled in settings, skipping autoconfigure`);
		return { configured: false };
	}

	if (!IS_RUNNING_ON_PWB) {
		log.debug(`[${displayName}] Not running on Posit Workbench, skipping autoconfigure`);
		return { configured: false };
	}

	// Auth provider path: check for VS Code auth session availability
	if (credentialConfig.authProvider) {
		try {
			const session = await vscode.authentication.getSession(
				credentialConfig.authProvider.id,
				credentialConfig.authProvider.scopes,
				{ createIfNone: false, silent: true }
			);
			if (!session) {
				log.debug(`[${displayName}] Auth provider session not available`);
				return { configured: false };
			}

			log.info(`[${displayName}] Auto-configuring with auth provider credentials`);
			return {
				configured: true,
				message: credentialConfig.displayName,
			};
		} catch (e) {
			log.debug(`[${displayName}] Auth provider check failed: ${e instanceof Error ? e.message : String(e)}`);
			return { configured: false };
		}
	}

	// Env var path (existing behavior for AWS/Snowflake)
	if (credentialConfig.envVar) {
		let tokenEnv = process.env[credentialConfig.envVar];

		// Also check provider variables if configured
		if (!tokenEnv && credentialConfig.providerVariableKey) {
			const configSettings = vscode.workspace.getConfiguration('positron.assistant.providerVariables').get<Record<string, any>>(credentialConfig.providerVariableKey, {});
			tokenEnv = configSettings[credentialConfig.envVar];
			log.debug(`[${displayName}] Checked provider variables for ${credentialConfig.envVar}: ${tokenEnv ? 'found' : 'not found'}`);
		}

		if (!tokenEnv || !credentialConfig.validator?.(tokenEnv)) {
			log.debug(`[${displayName}] Managed credentials not available: ${credentialConfig.envVar}=${tokenEnv ? 'set but invalid' : 'not set'}`);
			return { configured: false };
		}

		log.info(`[${displayName}] Auto-configuring with managed credentials`);
		return {
			configured: true,
			message: credentialConfig.displayName
		};
	}

	return { configured: false };
}

/**
 * Checks whether managed credentials are available for the given credential
 * configuration on Posit Workbench. This is a pure check with no side effects.
 *
 * @param credentialConfig - The credential configuration to check
 * @returns Whether managed credentials are available and valid
 */
export function hasManagedCredentials(credentialConfig: ManagedCredentialConfig): boolean {
	if (!IS_RUNNING_ON_PWB) {
		return false;
	}

	let tokenEnv = process.env[credentialConfig.envVar];

	if (!tokenEnv && credentialConfig.providerVariableKey) {
		const configSettings = vscode.workspace.getConfiguration('positron.assistant.providerVariables')
			.get<Record<string, any>>(credentialConfig.providerVariableKey, {});
		tokenEnv = configSettings[credentialConfig.envVar];
	}

	return !!tokenEnv && credentialConfig.validator(tokenEnv);
}
