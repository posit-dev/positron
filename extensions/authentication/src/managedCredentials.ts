/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	DATABRICKS_AUTH_PROVIDER_ID,
	FOUNDRY_AUTH_PROVIDER_ID,
	IS_RUNNING_ON_PWB,
} from './constants';

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
		const config = vscode.workspace.getConfiguration('posit.workbench.foundry');
		return !!config.get<string>('endpoint', '');
	},
};

/**
 * Snowflake managed credentials configuration for Posit Workbench.
 */
export const SNOWFLAKE_MANAGED_CREDENTIALS: EnvVarCredentialConfig = {
	kind: 'env-var',
	displayName: 'OAuth (Workbench Managed Credentials)',
	envVar: 'SNOWFLAKE_HOME',
	validator: (value: string) => value.includes('posit-workbench'),
};

/**
 * Databricks managed credentials configuration for Posit Workbench.
 */
export const DATABRICKS_MANAGED_CREDENTIALS: EnvVarCredentialConfig = {
	kind: 'env-var',
	displayName: 'OAuth (Workbench Managed Credentials)',
	envVar: 'DATABRICKS_CONFIG_FILE',
	validator: (value: string) => value.includes('posit-workbench'),
};

/** Managed credentials by the auth provider ID they back. */
const MANAGED_CREDENTIALS_BY_PROVIDER: ReadonlyMap<string, ManagedCredentialConfig> = new Map<string, ManagedCredentialConfig>([
	[FOUNDRY_AUTH_PROVIDER_ID, FOUNDRY_MANAGED_CREDENTIALS],
	['snowflake-cortex', SNOWFLAKE_MANAGED_CREDENTIALS],
	[DATABRICKS_AUTH_PROVIDER_ID, DATABRICKS_MANAGED_CREDENTIALS],
]);

/**
 * The managed credentials Posit Workbench is supplying right now, for either a
 * credential configuration or the auth provider ID one backs. Returns undefined
 * when there are none or they are inactive.
 */
export function hasManagedCredentials(
	target: ManagedCredentialConfig | string,
	isRunningOnPwb = IS_RUNNING_ON_PWB
): ManagedCredentialConfig | undefined {
	const credentialConfig = typeof target === 'string'
		? MANAGED_CREDENTIALS_BY_PROVIDER.get(target)
		: target;
	if (!credentialConfig || !isRunningOnPwb) {
		return undefined;
	}

	switch (credentialConfig.kind) {
		case 'auth-token': {
			const ext = vscode.extensions.getExtension('rstudio.rstudio-workbench');
			if (!ext?.isActive) {
				return undefined;
			}
			return credentialConfig.validator() ? credentialConfig : undefined;
		}
		case 'env-var': {
			const envValue = process.env[credentialConfig.envVar];
			return envValue && credentialConfig.validator(envValue)
				? credentialConfig
				: undefined;
		}
	}
}
