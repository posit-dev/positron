/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IS_RUNNING_ON_PWB } from './constants';

/**
 * Managed credentials provided by PWB extension via authentication provider.
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
 * Managed credentials backed by an environment variable.
 */
export interface EnvVarCredentialConfig {
	readonly kind: 'env-var';
	readonly displayName: string;
	/** Environment variable name that indicates managed credentials are available. */
	readonly envVar: string;
	/** Validator function to confirm the env var value for managed credentials. */
	readonly validator: (value: string) => boolean;
	/** Optional setting key under `authentication.<key>.credentials` for fallback lookup. */
	readonly settingKey?: string;
}

/**
 * Configuration for managed credentials on Posit Workbench.
 */
export type ManagedCredentialConfig =
	| AuthTokenCredentialConfig
	| EnvVarCredentialConfig;

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
 * Snowflake managed credentials configuration for Posit Workbench.
 */
export const SNOWFLAKE_MANAGED_CREDENTIALS: EnvVarCredentialConfig = {
	kind: 'env-var',
	displayName: 'OAuth (Managed)',
	envVar: 'SNOWFLAKE_HOME',
	settingKey: 'snowflake',
	validator: (value: string) => value.includes('posit-workbench'),
};

/**
 * Checks whether managed credentials are available for the given
 * credential configuration on Posit Workbench.
 */
export function hasManagedCredentials(
	credentialConfig: ManagedCredentialConfig
): boolean {
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
			let envValue = process.env[credentialConfig.envVar];

			// Also check settings if a setting key is configured
			if (!envValue && credentialConfig.settingKey) {
				const settings = vscode.workspace
					.getConfiguration(`authentication.${credentialConfig.settingKey}`)
					.get<Record<string, string>>('credentials', {});
				envValue = settings[credentialConfig.envVar];
			}

			return !!envValue && credentialConfig.validator(envValue);
		}
	}
}
