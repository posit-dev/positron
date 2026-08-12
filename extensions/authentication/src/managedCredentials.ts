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

/**
 * Checks whether managed credentials are available for the given
 * credential configuration on Posit Workbench.
 */
export function hasManagedCredentials(
	credentialConfig: ManagedCredentialConfig,
	isRunningOnPwb = IS_RUNNING_ON_PWB
): boolean {
	if (!isRunningOnPwb) {
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
			const envValue = process.env[credentialConfig.envVar];
			return !!envValue && credentialConfig.validator(envValue);
		}
	}
}
