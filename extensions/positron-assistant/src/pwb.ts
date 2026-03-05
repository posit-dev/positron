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
 * Managed credentials backed by an environment variable
 */
export interface EnvVarCredentialConfig {
	readonly kind: 'env-var';
	readonly displayName: string;
	readonly envVar: string;
	readonly validator: (value: string) => boolean;
	readonly providerVariableKey?: string;
}

/**
 * Managed credentials provided by PWB extension
 */
export interface AuthTokenCredentialConfig {
	readonly kind: 'auth-token';
	readonly displayName: string;
	readonly authProvider: {
		readonly id: string;
		readonly scopes: string[];
	};
	readonly validator: () => boolean;
}

/**
 * Configuration for managed credentials on Posit Workbench.
 */
export type ManagedCredentialConfig =
	| EnvVarCredentialConfig
	| AuthTokenCredentialConfig;

/**
 * AWS managed credentials configuration for Posit Workbench.
 */
export const AWS_MANAGED_CREDENTIALS: EnvVarCredentialConfig = {
	kind: 'env-var',
	displayName: 'AWS managed credentials',
	envVar: 'AWS_WEB_IDENTITY_TOKEN_FILE',
	providerVariableKey: 'bedrock',
	validator: (value: string) => value.includes('posit-workbench'),
};

/**
 * Snowflake managed credentials configuration for Posit Workbench.
 */
export const SNOWFLAKE_MANAGED_CREDENTIALS: EnvVarCredentialConfig = {
	kind: 'env-var',
	displayName: 'OAuth (Managed)',
	envVar: 'SNOWFLAKE_HOME',
	providerVariableKey: 'snowflake',
	validator: (value: string) => value.includes('posit-workbench'),
};

/**
 * Foundry managed credentials configuration for Posit Workbench.
 */
export const FOUNDRY_MANAGED_CREDENTIALS: AuthTokenCredentialConfig = {
	kind: 'auth-token',
	displayName: 'Foundry managed credentials',
	authProvider: {
		id: 'posit-workbench',
		scopes: ['msfoundry'],
	},
	validator: () => {
		const config = vscode.workspace.getConfiguration('positWorkbench.foundry');
		return !!config.get<string>('endpoint', '');
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

	switch (credentialConfig.kind) {
		case 'auth-token': {
			log.info(`[${displayName}] Auto-configuring with auth token credentials`);
			return {
				configured: true,
				message: credentialConfig.displayName,
			};
		}
		case 'env-var': {
			let tokenEnv = process.env[credentialConfig.envVar];

			// Also check provider variables if configured
			if (!tokenEnv && credentialConfig.providerVariableKey) {
				const configSettings = vscode.workspace.getConfiguration('positron.assistant.providerVariables').get<Record<string, any>>(credentialConfig.providerVariableKey, {});
				tokenEnv = configSettings[credentialConfig.envVar];
				log.debug(`[${displayName}] Checked provider variables for ${credentialConfig.envVar}: ${tokenEnv ? 'found' : 'not found'}`);
			}

			if (!tokenEnv || !credentialConfig.validator(tokenEnv)) {
				log.debug(`[${displayName}] Managed credentials not available: ${credentialConfig.envVar}=${tokenEnv ? 'set but invalid' : 'not set'}`);
				return { configured: false };
			}

			log.info(`[${displayName}] Auto-configuring with managed credentials`);
			return {
				configured: true,
				message: credentialConfig.displayName
			};
		}
	}
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

	switch (credentialConfig.kind) {
		case 'auth-token': {
			const ext = vscode.extensions.getExtension('rstudio.rstudio-workbench');
			if (!ext?.isActive) {
				return false;
			}
			return credentialConfig.validator();
		}
		case 'env-var': {
			let tokenEnv = process.env[credentialConfig.envVar];

			if (!tokenEnv && credentialConfig.providerVariableKey) {
				const configSettings = vscode.workspace.getConfiguration('positron.assistant.providerVariables')
					.get<Record<string, any>>(credentialConfig.providerVariableKey, {});
				tokenEnv = configSettings[credentialConfig.envVar];
			}

			return !!tokenEnv && credentialConfig.validator(tokenEnv);
		}
	}
}
