/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
	readonly validator: (string) => boolean;
}

/**
 * AWS managed credentials configuration for Posit Workbench.
 */
export const AWS_MANAGED_CREDENTIALS: ManagedCredentialConfig = {
	displayName: 'AWS managed credentials',
	envVar: 'AWS_WEB_IDENTITY_TOKEN_FILE',
	validator: (value: string) => value.includes('posit-workbench'),
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
	// - We are on PWB, and
	// - the provider is enabled in settings, and
	// - managed credentials are available

	if (!IS_RUNNING_ON_PWB) {
		return { signedIn: false };
	}

	const providerEnabled = await getEnabledProviders().then(
		providers => providers.includes(providerId)
	);
	if (!providerEnabled) {
		return { signedIn: false };
	}

	// Check for managed credentials using the provided config
	const tokenEnv = process.env[credentialConfig.envVar];
	if (!tokenEnv || !credentialConfig.validator(tokenEnv)) {
		// PWB managed credentials not set
		return { signedIn: false };
	}

	log.info(`[${displayName}] Auto-configuring with managed credentials.`);
	return {
		signedIn: true,
		message: credentialConfig.displayName,
	};
}
